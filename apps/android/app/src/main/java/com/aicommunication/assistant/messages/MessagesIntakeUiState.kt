package com.aicommunication.assistant.messages

sealed class MessagesIntakeUiState {
    data object CheckingAccess : MessagesIntakeUiState()

    data object AccessDisabled : MessagesIntakeUiState()

    data class Ready(
        val eligible: List<MessagesReviewItem>,
        val filtered: List<MessagesFilteredItem>,
        val listenerError: Boolean,
        val shapes: List<MessagesNotificationShape>,
        val selectedId: String? = null,
        val reviewing: Boolean = false,
        val reviewError: String? = null,
        val reviewConnectivityIssue: Boolean = false,
        val canRetryReview: Boolean = false
    ) : MessagesIntakeUiState() {
        val canReview: Boolean
            get() =
                selectedId != null &&
                    !reviewing &&
                    eligible.any { it.id == selectedId }
    }
}
