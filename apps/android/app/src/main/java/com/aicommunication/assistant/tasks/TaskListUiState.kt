package com.aicommunication.assistant.tasks

sealed class TaskListUiState {
    data object Loading : TaskListUiState()

    data class Ready(
        val tasks: List<OwnerTask>,
        val nextCursor: String?,
        val loadingMore: Boolean = false,
        val refreshing: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false
    ) : TaskListUiState()

    data class Error(
        val message: String,
        val connectivityIssue: Boolean = false
    ) : TaskListUiState()
}
