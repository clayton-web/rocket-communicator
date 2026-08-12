package com.aicommunication.assistant.capture

/**
 * Presentation-only rendering rules for read-only proposal results (S3.3b, D171).
 *
 * Android displays what the canonical summary points already say. It infers no Recipient, no
 * responsibility, and no deadline beyond the point data itself.
 */

/** Reuses the shared capture title rule so a proposal reads like the Task it may later become. */
fun deriveProposalTitle(proposal: TaskSuggestionWire): String =
    deriveCapturedTaskTitle(proposal.id, orderedSummaryPoints(proposal))

/**
 * Canonical `order` decides display order; ties keep server order so repeated renders of the same
 * response are identical.
 */
fun orderedSummaryPoints(proposal: TaskSuggestionWire): List<CaptureSummaryPointWire> =
    proposal.summaryPoints.sortedBy { it.order }

/** The detail line for one summary point: its value when it carries text, otherwise its label. */
fun summaryPointDetail(point: CaptureSummaryPointWire): String {
    val value = point.value?.trim().orEmpty()
    return if (value.isNotEmpty()) value else point.label.trim()
}
