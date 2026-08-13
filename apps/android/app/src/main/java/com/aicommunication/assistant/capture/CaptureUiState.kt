package com.aicommunication.assistant.capture

import com.aicommunication.assistant.tasks.RecipientWire

/**
 * Owner manual-capture presentation state (S3.3b / S5.2, D171 / D176).
 *
 * Capture itself still creates no canonical Task. [Proposals] may open a single Accept
 * interaction; that is the only proposal lifecycle surface in S5.2.
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
     * At most one [accept] interaction is open at a time. Responsibility starts unselected.
     */
    data class Proposals(
        val capturedText: String,
        val proposals: List<TaskSuggestionWire>,
        val accept: ProposalAcceptInteraction? = null,
        val notice: String? = null
    ) : CaptureUiState()
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
