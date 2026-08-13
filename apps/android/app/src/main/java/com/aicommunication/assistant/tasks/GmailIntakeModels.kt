package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Hand-written Gmail intake/review wire DTOs (S7, D179).
 *
 * Generated [com.aicommunication.assistant.contracts.models.GmailReviewResponse] embeds the
 * polymorphic [com.aicommunication.assistant.contracts.models.TaskSuggestion] tree, which Moshi
 * cannot decode without a custom adapter stack. Review proposals therefore reuse the existing
 * [TaskSuggestionWire] shape already proven against manual capture.
 *
 * Intake items stay narrow: enough to select a message and Review with Rocket, not a
 * communication-event browser.
 */
@JsonClass(generateAdapter = false)
data class GmailIntakeItemWire(
    @Json(name = "id")
    val id: String,
    @Json(name = "fromAddress")
    val fromAddress: String,
    @Json(name = "receivedAt")
    val receivedAt: String,
    @Json(name = "subject")
    val subject: String? = null,
    @Json(name = "snippet")
    val snippet: String? = null
)

@JsonClass(generateAdapter = false)
data class GmailIntakePageWire(
    @Json(name = "items")
    val items: List<GmailIntakeItemWire> = emptyList(),
    @Json(name = "nextCursor")
    val nextCursor: String? = null
)

@JsonClass(generateAdapter = false)
data class GmailReviewRequestWire(
    @Json(name = "communicationEventId")
    val communicationEventId: String
)

@JsonClass(generateAdapter = false)
data class GmailReviewResponseWire(
    @Json(name = "idempotentReplay")
    val idempotentReplay: Boolean,
    @Json(name = "interpretedAt")
    val interpretedAt: String,
    /** 0..10 canonical pending proposals; an empty list is truthful success, not a failure. */
    @Json(name = "taskSuggestions")
    val taskSuggestions: List<TaskSuggestionWire>
)

internal fun GmailIntakeItemWire.reviewSourceText(): String = subject?.takeIf { it.isNotBlank() }
    ?: snippet?.takeIf { it.isNotBlank() }
    ?: fromAddress
