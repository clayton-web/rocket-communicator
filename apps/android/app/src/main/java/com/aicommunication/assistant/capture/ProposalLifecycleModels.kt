package com.aicommunication.assistant.capture

import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskWire
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Affirmative D168 responsibility selection for proposal approval (S5.1).
 *
 * Owner/Me must serialize without a `recipientId` property at all. Recipient names one saved
 * Recipient and is not the legacy top-level approve `recipientId`.
 */
sealed class ProposalResponsibility {
    data object Owner : ProposalResponsibility()

    data class Recipient(val recipientId: String) : ProposalResponsibility()
}

@JsonClass(generateAdapter = false)
data class ProposalResponsibilityWire(
    @Json(name = "responsibleParty")
    val responsibleParty: String,
    @Json(name = "recipientId")
    val recipientId: String? = null
)

@JsonClass(generateAdapter = false)
data class ApproveProposalRequestWire(
    @Json(name = "acknowledgement")
    val acknowledgement: String,
    @Json(name = "responsibility")
    val responsibility: ProposalResponsibilityWire
)

@JsonClass(generateAdapter = false)
data class EditProposalRequestWire(
    @Json(name = "summaryPoints")
    val summaryPoints: List<CaptureSummaryPointWire>
)

@JsonClass(generateAdapter = false)
data class ApproveProposalResponseWire(
    @Json(name = "suggestion")
    val suggestion: TaskSuggestionWire,
    @Json(name = "task")
    val task: TaskWire
)

data class ApproveProposalResult(
    val suggestion: TaskSuggestionWire,
    val task: OwnerTask
)

internal fun ProposalResponsibility.toWire(): ProposalResponsibilityWire = when (this) {
    ProposalResponsibility.Owner ->
        ProposalResponsibilityWire(responsibleParty = "owner")
    is ProposalResponsibility.Recipient ->
        ProposalResponsibilityWire(
            responsibleParty = "recipient",
            recipientId = recipientId
        )
}
