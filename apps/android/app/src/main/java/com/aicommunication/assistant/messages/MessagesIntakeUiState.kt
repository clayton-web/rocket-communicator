package com.aicommunication.assistant.messages

sealed class MessagesIntakeUiState {
    data object CheckingAccess : MessagesIntakeUiState()

    data object AccessDisabled : MessagesIntakeUiState()

    data class Ready(
        val eligible: List<MessagesReviewItem>,
        val filtered: List<MessagesFilteredItem>,
        val listenerError: Boolean,
        val shapes: List<MessagesNotificationShape>,
        val selectedId: String? = null
    ) : MessagesIntakeUiState()
}
