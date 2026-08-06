package com.aicommunication.assistant.tasks

sealed class TaskDetailUiState {
    data object Loading : TaskDetailUiState()

    data class Ready(
        val task: OwnerTask,
        val noteDraft: String = "",
        val mutating: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false,
        val banner: String? = null
    ) : TaskDetailUiState()

    data class Error(
        val message: String,
        val connectivityIssue: Boolean = false
    ) : TaskDetailUiState()
}
