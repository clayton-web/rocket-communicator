package com.aicommunication.assistant.capture

sealed class CaptureUiState {
    data class Editing(
        val draft: String = "",
        val submitting: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false
    ) : CaptureUiState()

    data class Captured(
        val task: CapturedTask
    ) : CaptureUiState()
}
