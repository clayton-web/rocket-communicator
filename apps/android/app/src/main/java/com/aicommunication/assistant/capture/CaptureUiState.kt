package com.aicommunication.assistant.capture

/**
 * Owner manual-capture presentation state (S3.3b, D171).
 *
 * Capture submits to the shared interpretation route and shows what Rocket proposed. It never
 * creates a canonical Task, so there is no captured-Task state here: [Proposals] is read-only.
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
     */
    data class Proposals(
        val capturedText: String,
        val proposals: List<TaskSuggestionWire>
    ) : CaptureUiState()
}
