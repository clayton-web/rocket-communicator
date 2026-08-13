package com.aicommunication.assistant.capture

import com.aicommunication.assistant.tasks.RecipientWire

/**
 * Owner manual-capture presentation state (S3.3b / S5.3, D171 / D176).
 *
 * Capture itself still creates no canonical Task. [Proposals] may open a single Accept, Edit, or
 * Dismiss interaction at a time.
 */
sealed class CaptureUiState {
    data class Editing(
        val draft: String = "",
        val submitting: Boolean = false,
        val errorMessage: String? = null
    ) : CaptureUiState()

    /**
     * A persisted pending capture whose outcome is unknown — ambiguous failure or process death.
     * Rocket never resends this on its own; the Owner chooses Retry or Discard.
     */
    data class Recovery(
        val rawInput: String,
        val submitting: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false
    ) : CaptureUiState()

    /**
     * A committed interpretation. [proposals] may be empty, which is truthful success rather than
     * failure. [capturedText] is kept so the Owner can rephrase a capture Rocket could not use.
     *
     * [origin] distinguishes manual capture from Gmail Review so footer copy can return to the
     * right surface without a second proposal-review UI.
     *
     * At most one of [accept], [edit], or [dismiss] is open at a time. Responsibility starts
     * unselected. Edit drafts live only in this in-memory state.
     */
    data class Proposals(
        val capturedText: String,
        val proposals: List<TaskSuggestionWire>,
        val origin: ProposalOrigin = ProposalOrigin.ManualCapture,
        val accept: ProposalAcceptInteraction? = null,
        val edit: ProposalEditInteraction? = null,
        val dismiss: ProposalDismissInteraction? = null,
        val notice: String? = null
    ) : CaptureUiState() {
        val interactionBusy: Boolean
            get() = accept?.busy == true || edit?.busy == true || dismiss?.busy == true
    }
}

/** Which Owner action produced the proposals currently on the shared S5 review surface. */
enum class ProposalOrigin {
    ManualCapture,
    GmailReview
}

/**
 * Inline Accept interaction for one proposal (S5.2). [selectedResponsibility] is null until the
 * Owner affirmatively chooses Me / Owner or one saved Recipient.
 */
data class ProposalAcceptInteraction(
    val proposalId: String,
    val selectedResponsibility: ProposalResponsibility? = null,
    val recipients: List<RecipientWire> = emptyList(),
    val recipientsLoading: Boolean = false,
    val recipientsError: String? = null,
    val approving: Boolean = false,
    val recovering: Boolean = false,
    val recoveryReadFailed: Boolean = false,
    val message: String? = null
) {
    val busy: Boolean get() = approving || recovering

    val canConfirm: Boolean
        get() = selectedResponsibility != null && !busy && !recoveryReadFailed
}

/**
 * Inline Edit interaction for one proposal (S5.3). [draftPoints] start as the canonical ordered
 * summary points. Only existing [CaptureSummaryPointWire.value] wording is editable; id, kind,
 * label, and order stay as they were.
 */
data class ProposalEditInteraction(
    val proposalId: String,
    val draftPoints: List<CaptureSummaryPointWire>,
    val saving: Boolean = false,
    val message: String? = null
) {
    val busy: Boolean get() = saving

    val canSave: Boolean
        get() =
            !busy &&
                draftPoints.any { it.hasEditableWording } &&
                draftPoints.none { it.hasEditableWording && it.value.isNullOrBlank() }

    fun withPointWording(pointId: String, text: String): ProposalEditInteraction = copy(
        draftPoints =
        draftPoints.map { point ->
            if (point.id == pointId && point.hasEditableWording) {
                point.copy(value = text)
            } else {
                point
            }
        },
        message = null
    )

    fun summaryPointsForSave(): List<CaptureSummaryPointWire> = draftPoints.map { point ->
        if (point.value != null) point.copy(value = point.value.trim()) else point
    }
}

/**
 * Dismiss confirmation for one proposal (S5.3). Presence means the confirmation is showing.
 * Dismissal creates no Task.
 */
data class ProposalDismissInteraction(
    val proposalId: String,
    val dismissing: Boolean = false,
    val message: String? = null
) {
    val busy: Boolean get() = dismissing
}
