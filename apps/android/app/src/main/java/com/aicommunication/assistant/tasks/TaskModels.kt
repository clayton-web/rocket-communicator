package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.capture.CaptureSummaryPointWire
import com.aicommunication.assistant.capture.deriveCapturedTaskTitle
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Hand-written Task wire DTOs for A9.3 (D047).
 *
 * Generated [com.aicommunication.assistant.contracts.models.Task] embeds a polymorphic
 * summary-point interface unsuitable for Moshi without a custom adapter stack. These DTOs
 * parse the Owner-facing fields Android needs for list, detail, lifecycle, and handoff.
 */
@JsonClass(generateAdapter = false)
data class TaskWire(
    @Json(name = "id") val id: String,
    @Json(name = "etag") val etag: String,
    @Json(name = "status") val status: String,
    @Json(name = "version") val version: Int = 0,
    @Json(name = "summaryPoints") val summaryPoints: List<CaptureSummaryPointWire>? = null,
    @Json(name = "assignment") val assignment: AssignmentWire? = null,
    @Json(name = "notes") val notes: List<TaskNoteWire>? = null,
    @Json(name = "updatedAt") val updatedAt: String? = null,
    /** Canonical organization-local due calendar date (`YYYY-MM-DD`). Never reconstructed from `dueAt`. */
    @Json(name = "dueLocalDate") val dueLocalDate: String? = null,
    /** Read-time `due_soon` / `overdue` from `dueLocalDate`. Independent of assignment. */
    @Json(name = "derivedUrgency") val derivedUrgency: String? = null
)

@JsonClass(generateAdapter = false)
data class AssignmentWire(
    @Json(name = "recipientId") val recipientId: String? = null,
    @Json(name = "intendedRecipientEmail") val intendedRecipientEmail: String? = null,
    @Json(name = "deliveryStatus") val deliveryStatus: String? = null
)

@JsonClass(generateAdapter = false)
data class TaskNoteWire(
    @Json(name = "id") val id: String? = null,
    @Json(name = "body") val body: String? = null
)

@JsonClass(generateAdapter = false)
data class TaskListPageWire(
    @Json(name = "items") val items: List<TaskWire> = emptyList(),
    @Json(name = "nextCursor") val nextCursor: String? = null
)

@JsonClass(generateAdapter = false)
data class HandoffRequestWire(
    @Json(name = "recipientId") val recipientId: String,
    @Json(name = "acknowledgement") val acknowledgement: String = "handoff_confirmed_v1"
)

@JsonClass(generateAdapter = false)
data class HandoffResponseWire(
    @Json(name = "task") val task: TaskWire,
    @Json(name = "deliveryPath") val deliveryPath: String,
    @Json(name = "deliveryStatus") val deliveryStatus: String,
    @Json(name = "recipient") val recipient: RecipientWire,
    @Json(name = "capabilityId") val capabilityId: String,
    @Json(name = "requiresSendReconsent") val requiresSendReconsent: Boolean = false,
    @Json(name = "idempotentReplay") val idempotentReplay: Boolean = false
)

@JsonClass(generateAdapter = false)
data class RecipientWire(
    @Json(name = "id") val id: String,
    @Json(name = "displayName") val displayName: String,
    @Json(name = "email") val email: String,
    @Json(name = "active") val active: Boolean = true
)

@JsonClass(generateAdapter = false)
data class RecipientPageWire(
    @Json(name = "items") val items: List<RecipientWire> = emptyList(),
    @Json(name = "nextCursor") val nextCursor: String? = null
)

@JsonClass(generateAdapter = false)
data class CreateRecipientRequestWire(
    @Json(name = "displayName") val displayName: String,
    @Json(name = "email") val email: String
)

@JsonClass(generateAdapter = false)
data class GmailConnectionWire(
    @Json(name = "status") val status: String,
    @Json(name = "canSend") val canSend: Boolean? = null,
    @Json(name = "requiresSendReconsent") val requiresSendReconsent: Boolean? = null,
    @Json(name = "emailAddress") val emailAddress: String? = null,
    @Json(name = "readonlyScope") val readonlyScope: Boolean = false
)

/** Owner-facing Task projection for list/detail (presentation only). */
data class OwnerTask(
    val id: String,
    val etag: String,
    val status: String,
    val displayTitle: String,
    val assignmentEmail: String?,
    val deliveryStatus: String?,
    val noteBodies: List<String>,
    val updatedAt: String?,
    val dueLocalDate: String? = null,
    val derivedUrgency: String? = null
) {
    val isAssigned: Boolean get() = assignmentEmail != null
    val isTerminal: Boolean get() = status == "completed" || status == "dismissed"
    val canAssign: Boolean get() = !isAssigned && !isTerminal
    val isOwnerWork: Boolean get() = !isAssigned

    val statusLabel: String
        get() =
            when (status) {
                "open" -> "Open"
                "in_progress" -> "In progress"
                "waiting" -> "Waiting"
                "completed" -> "Completed"
                "dismissed" -> "Dismissed"
                else -> status
            }

    val ownershipLabel: String
        get() =
            if (isAssigned) {
                val delivery =
                    when (deliveryStatus) {
                        "sent" -> "sent"
                        "pending" -> "pending"
                        "failed" -> "failed"
                        else -> null
                    }
                if (delivery != null) {
                    "Assigned to $assignmentEmail ($delivery)"
                } else {
                    "Assigned to $assignmentEmail"
                }
            } else {
                "Owner work (unassigned)"
            }

    val urgencyLabel: String?
        get() =
            when (derivedUrgency) {
                "overdue" -> "Overdue"
                "due_soon" -> "Due soon"
                else -> null
            }
}

fun TaskWire.toOwnerTask(): OwnerTask = OwnerTask(
    id = id,
    etag = etag,
    status = status,
    displayTitle = deriveCapturedTaskTitle(id, summaryPoints),
    assignmentEmail = assignment?.intendedRecipientEmail?.takeIf { it.isNotBlank() },
    deliveryStatus = assignment?.deliveryStatus,
    noteBodies =
    notes
        ?.mapNotNull { it.body?.trim()?.takeIf { body -> body.isNotEmpty() } }
        .orEmpty(),
    updatedAt = updatedAt,
    dueLocalDate = dueLocalDate,
    derivedUrgency = derivedUrgency
)
