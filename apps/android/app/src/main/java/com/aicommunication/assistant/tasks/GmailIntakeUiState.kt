package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.capture.TaskSuggestionWire

sealed class GmailIntakeUiState {
    data object Loading : GmailIntakeUiState()

    data class Ready(
        val items: List<GmailIntakeItemWire>,
        val nextCursor: String?,
        val selectedId: String? = null,
        val reviewing: Boolean = false,
        val reviewError: String? = null,
        val reviewConnectivityIssue: Boolean = false,
        val canRetryReview: Boolean = false,
        val loadingMore: Boolean = false,
        val refreshing: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false
    ) : GmailIntakeUiState() {
        val canReview: Boolean
            get() =
                selectedId != null &&
                    !reviewing &&
                    items.any { it.id == selectedId }
    }

    data class Error(
        val message: String,
        val connectivityIssue: Boolean = false
    ) : GmailIntakeUiState()
}

/** Successful 0..N Gmail Review result handed to the existing S5 proposal-review surface. */
data class GmailReviewReady(
    val sourceText: String,
    val proposals: List<TaskSuggestionWire>
)
