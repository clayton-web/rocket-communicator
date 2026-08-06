package com.aicommunication.assistant.tasks

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.network.OwnerApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class TaskListViewModel(
    application: Application,
    private val repository: TaskOwnerRepository,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<TaskListUiState>(TaskListUiState.Loading)
    val uiState: StateFlow<TaskListUiState> = _uiState.asStateFlow()

    private fun str(id: Int): String = getApplication<Application>().getString(id)

    fun load() {
        viewModelScope.launch {
            _uiState.value = TaskListUiState.Loading
            when (val result = repository.listTasks()) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        TaskListUiState.Ready(
                            tasks = result.value.items,
                            nextCursor = result.value.nextCursor
                        )
                OwnerApiResult.Unauthorized -> {
                    _uiState.value =
                        TaskListUiState.Error(str(R.string.error_session_unavailable))
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        TaskListUiState.Error(
                            message = str(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                OwnerApiResult.NotConfigured ->
                    _uiState.value =
                        TaskListUiState.Error(str(R.string.error_auth_config))
                is OwnerApiResult.HttpError ->
                    _uiState.value =
                        TaskListUiState.Error(
                            result.message.ifBlank { str(R.string.tasks_error_generic) }
                        )
                is OwnerApiResult.Unexpected ->
                    _uiState.value =
                        TaskListUiState.Error(
                            result.message.ifBlank { str(R.string.tasks_error_generic) }
                        )
            }
        }
    }

    fun refresh() {
        val current = _uiState.value as? TaskListUiState.Ready ?: return load()
        viewModelScope.launch {
            _uiState.value =
                current.copy(
                    refreshing = true,
                    errorMessage = null,
                    connectivityIssue = false
                )
            when (val result = repository.listTasks()) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        TaskListUiState.Ready(
                            tasks = result.value.items,
                            nextCursor = result.value.nextCursor
                        )
                OwnerApiResult.Unauthorized -> {
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            refreshing = false,
                            errorMessage = str(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                else ->
                    _uiState.value =
                        current.copy(
                            refreshing = false,
                            errorMessage = str(R.string.tasks_error_generic)
                        )
            }
        }
    }

    fun loadMore() {
        val current = _uiState.value as? TaskListUiState.Ready ?: return
        val cursor = current.nextCursor ?: return
        if (current.loadingMore) return
        viewModelScope.launch {
            _uiState.value = current.copy(loadingMore = true, errorMessage = null)
            when (val result = repository.listTasks(cursor = cursor)) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        TaskListUiState.Ready(
                            tasks = current.tasks + result.value.items,
                            nextCursor = result.value.nextCursor
                        )
                OwnerApiResult.Unauthorized -> onSessionInvalidated()
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            loadingMore = false,
                            errorMessage = str(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                else ->
                    _uiState.value =
                        current.copy(
                            loadingMore = false,
                            errorMessage = str(R.string.tasks_error_generic)
                        )
            }
        }
    }

    class Factory(
        private val application: Application,
        private val repository: TaskOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskListViewModel::class.java)) {
                return TaskListViewModel(application, repository, onSessionInvalidated) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
