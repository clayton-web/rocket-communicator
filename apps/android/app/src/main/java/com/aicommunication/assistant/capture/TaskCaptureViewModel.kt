package com.aicommunication.assistant.capture

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class TaskCaptureViewModel(
    application: Application,
    private val captureTask: CaptureTaskUseCase,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<CaptureUiState>(CaptureUiState.Editing())
    val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

    fun onDraftChanged(value: String) {
        val current = _uiState.value
        if (current is CaptureUiState.Editing && !current.submitting) {
            _uiState.value =
                current.copy(
                    draft = value,
                    errorMessage = null,
                    connectivityIssue = false
                )
        }
    }

    fun save() {
        val current = _uiState.value as? CaptureUiState.Editing ?: return
        if (current.submitting) return
        val draft = current.draft
        if (draft.trim().isEmpty()) return

        viewModelScope.launch {
            _uiState.value =
                current.copy(
                    submitting = true,
                    errorMessage = null,
                    connectivityIssue = false
                )
            when (val result = captureTask.execute(draft)) {
                is OwnerApiResult.Success -> {
                    _uiState.value = CaptureUiState.Captured(result.value)
                }
                OwnerApiResult.Unauthorized -> {
                    _uiState.value =
                        CaptureUiState.Editing(
                            draft = draft,
                            submitting = false,
                            errorMessage =
                            getApplication<Application>()
                                .getString(R.string.capture_error_session)
                        )
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity -> {
                    _uiState.value =
                        CaptureUiState.Editing(
                            draft = draft,
                            submitting = false,
                            errorMessage =
                            getApplication<Application>()
                                .getString(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                }
                OwnerApiResult.NotConfigured -> {
                    _uiState.value =
                        CaptureUiState.Editing(
                            draft = draft,
                            submitting = false,
                            errorMessage =
                            getApplication<Application>()
                                .getString(R.string.error_auth_config)
                        )
                }
                is OwnerApiResult.HttpError -> {
                    val message =
                        when (result.code) {
                            ErrorCode.VALIDATION_ERROR ->
                                getApplication<Application>()
                                    .getString(R.string.capture_error_validation)
                            else ->
                                result.message.ifBlank {
                                    getApplication<Application>()
                                        .getString(R.string.capture_error_generic)
                                }
                        }
                    _uiState.value =
                        CaptureUiState.Editing(
                            draft = draft,
                            submitting = false,
                            errorMessage = message
                        )
                }
                is OwnerApiResult.Unexpected -> {
                    _uiState.value =
                        CaptureUiState.Editing(
                            draft = draft,
                            submitting = false,
                            errorMessage =
                            result.message.ifBlank {
                                getApplication<Application>()
                                    .getString(R.string.capture_error_generic)
                            }
                        )
                }
            }
        }
    }

    fun captureAnother() {
        _uiState.value = CaptureUiState.Editing()
    }

    fun clearError() {
        _uiState.update { state ->
            if (state is CaptureUiState.Editing) {
                state.copy(errorMessage = null, connectivityIssue = false)
            } else {
                state
            }
        }
    }

    class Factory(
        private val application: Application,
        private val captureTask: CaptureTaskUseCase,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskCaptureViewModel::class.java)) {
                return TaskCaptureViewModel(application, captureTask, onSessionInvalidated) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
