package com.aicommunication.assistant.tasks

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class TaskDetailViewModel(
    application: Application,
    private val repository: TaskOwnerRepository,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<TaskDetailUiState>(TaskDetailUiState.Loading)
    val uiState: StateFlow<TaskDetailUiState> = _uiState.asStateFlow()

    private var taskId: String? = null

    private fun str(id: Int): String = getApplication<Application>().getString(id)

    fun load(id: String) {
        taskId = id
        viewModelScope.launch {
            _uiState.value = TaskDetailUiState.Loading
            applyLoad(repository.getTask(id))
        }
    }

    fun onNoteDraftChanged(value: String) {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        if (!current.mutating) {
            _uiState.value = current.copy(noteDraft = value, errorMessage = null)
        }
    }

    fun start() = mutate { repository.startTask(it.id, it.etag) }

    fun waiting() = mutate { repository.markWaiting(it.id, it.etag) }

    fun resume() = mutate { repository.resumeTask(it.id, it.etag) }

    fun complete() = mutate { repository.completeTask(it.id, it.etag) }

    fun dismiss() = mutate { repository.dismissTask(it.id, it.etag) }

    fun addNote() {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        val body = current.noteDraft.trim()
        if (body.isEmpty() || current.mutating) return
        mutate { repository.addNote(it.id, it.etag, body) }
    }

    fun refresh() {
        val id = taskId ?: return
        load(id)
    }

    private fun mutate(block: suspend (OwnerTask) -> OwnerApiResult<OwnerTask>) {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        if (current.mutating) return
        viewModelScope.launch {
            _uiState.value =
                current.copy(
                    mutating = true,
                    errorMessage = null,
                    connectivityIssue = false,
                    banner = null
                )
            when (val result = block(current.task)) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        TaskDetailUiState.Ready(
                            task = result.value,
                            noteDraft = "",
                            banner = str(R.string.task_detail_updated)
                        )
                OwnerApiResult.Unauthorized -> {
                    _uiState.value =
                        current.copy(
                            mutating = false,
                            errorMessage = str(R.string.error_session_unavailable)
                        )
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            mutating = false,
                            errorMessage = str(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                OwnerApiResult.NotConfigured ->
                    _uiState.value =
                        current.copy(
                            mutating = false,
                            errorMessage = str(R.string.error_auth_config)
                        )
                is OwnerApiResult.HttpError -> {
                    if (result.code == ErrorCode.PRECONDITION_FAILED) {
                        val id = taskId
                        if (id != null) {
                            when (val fresh = repository.getTask(id)) {
                                is OwnerApiResult.Success ->
                                    _uiState.value =
                                        TaskDetailUiState.Ready(
                                            task = fresh.value,
                                            noteDraft = current.noteDraft,
                                            errorMessage = str(R.string.task_detail_stale_etag)
                                        )
                                else ->
                                    _uiState.value =
                                        current.copy(
                                            mutating = false,
                                            errorMessage = str(R.string.task_detail_stale_etag)
                                        )
                            }
                        }
                    } else {
                        _uiState.value =
                            current.copy(
                                mutating = false,
                                errorMessage =
                                result.message.ifBlank { str(R.string.tasks_error_generic) }
                            )
                    }
                }
                is OwnerApiResult.Unexpected ->
                    _uiState.value =
                        current.copy(
                            mutating = false,
                            errorMessage =
                            result.message.ifBlank { str(R.string.tasks_error_generic) }
                        )
            }
        }
    }

    private fun applyLoad(result: OwnerApiResult<OwnerTask>) {
        when (result) {
            is OwnerApiResult.Success ->
                _uiState.value = TaskDetailUiState.Ready(task = result.value)
            OwnerApiResult.Unauthorized -> {
                _uiState.value =
                    TaskDetailUiState.Error(str(R.string.error_session_unavailable))
                onSessionInvalidated()
            }
            OwnerApiResult.Connectivity ->
                _uiState.value =
                    TaskDetailUiState.Error(
                        message = str(R.string.error_connectivity),
                        connectivityIssue = true
                    )
            OwnerApiResult.NotConfigured ->
                _uiState.value =
                    TaskDetailUiState.Error(str(R.string.error_auth_config))
            is OwnerApiResult.HttpError ->
                _uiState.value =
                    TaskDetailUiState.Error(
                        result.message.ifBlank { str(R.string.tasks_error_generic) }
                    )
            is OwnerApiResult.Unexpected ->
                _uiState.value =
                    TaskDetailUiState.Error(
                        result.message.ifBlank { str(R.string.tasks_error_generic) }
                    )
        }
    }

    class Factory(
        private val application: Application,
        private val repository: TaskOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskDetailViewModel::class.java)) {
                return TaskDetailViewModel(application, repository, onSessionInvalidated) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
