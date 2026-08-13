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
    private val reminderRepository: ReminderOwnerRepository,
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
            applyLoad(id)
        }
    }

    fun onNoteDraftChanged(value: String) {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        if (!current.mutating) {
            _uiState.value = current.copy(noteDraft = value, errorMessage = null)
        }
    }

    fun start() = mutateTask { repository.startTask(it.id, it.etag) }

    fun waiting() = mutateTask { repository.markWaiting(it.id, it.etag) }

    fun resume() = mutateTask { repository.resumeTask(it.id, it.etag) }

    fun complete() = mutateTask { repository.completeTask(it.id, it.etag) }

    fun dismiss() = mutateTask { repository.dismissTask(it.id, it.etag) }

    fun addNote() {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        val body = current.noteDraft.trim()
        if (body.isEmpty() || current.mutating) return
        mutateTask { repository.addNote(it.id, it.etag, body) }
    }

    fun setDueDate(dueLocalDate: String) {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        val reminderEtag = current.reminderEtag ?: return
        if (!current.canEditDueDate) return
        if (!DueLocalDates.isValid(dueLocalDate)) {
            _uiState.value =
                current.copy(errorMessage = str(R.string.task_detail_due_date_invalid))
            return
        }
        mutateReminder(ReminderWriteKind.DEADLINE) {
            reminderRepository.setDueDate(it.id, reminderEtag, dueLocalDate)
        }
    }

    fun clearDueDate() {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        val reminderEtag = current.reminderEtag ?: return
        if (!current.canEditDueDate) return
        mutateReminder(ReminderWriteKind.DEADLINE) {
            reminderRepository.clearDueDate(it.id, reminderEtag)
        }
    }

    fun setAdvanceEnabled(enabled: Boolean) {
        val current = _uiState.value as? TaskDetailUiState.Ready ?: return
        val reminderEtag = current.reminderEtag ?: return
        val dueLocalDate = current.task.dueLocalDate ?: return
        if (!current.canEditAdvanceReminder) return
        if (current.advanceEnabled == enabled) return
        mutateReminder(ReminderWriteKind.ADVANCE) {
            reminderRepository.setAdvanceEnabled(
                it.id,
                reminderEtag,
                dueLocalDate,
                enabled
            )
        }
    }

    fun refresh() {
        val id = taskId ?: return
        load(id)
    }

    private fun mutateTask(block: suspend (OwnerTask) -> OwnerApiResult<OwnerTask>) {
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
                        readyAfterTaskWrite(
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
                        rereadAfterTaskConflict(current.noteDraft)
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

    private fun mutateReminder(
        kind: ReminderWriteKind,
        block: suspend (OwnerTask) -> OwnerApiResult<TaskReminderWire>
    ) {
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
                    applyReminderWrite(current, result.value, kind)
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
                    if (isReminderStale(result)) {
                        rereadAfterReminderConflict(current.noteDraft)
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

    private suspend fun applyLoad(id: String) {
        when (val result = repository.getTask(id)) {
            is OwnerApiResult.Success ->
                _uiState.value = readyFromTask(result.value)
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

    private suspend fun applyReminderWrite(
        previous: TaskDetailUiState.Ready,
        reminder: TaskReminderWire,
        kind: ReminderWriteKind
    ) {
        val id = taskId ?: previous.task.id
        val banner =
            when {
                reminder.dueLocalDate == null -> str(R.string.task_detail_due_date_removed)
                kind == ReminderWriteKind.ADVANCE -> str(R.string.task_detail_advance_updated)
                else -> str(R.string.task_detail_due_date_saved)
            }
        when (val freshTask = repository.getTask(id)) {
            is OwnerApiResult.Success ->
                _uiState.value =
                    readyFromReminder(
                        task = freshTask.value,
                        reminder = reminder,
                        banner = banner
                    )
            else ->
                _uiState.value =
                    readyFromReminder(
                        task =
                        previous.task.copy(
                            dueLocalDate = reminder.dueLocalDate,
                            derivedUrgency = null
                        ),
                        reminder = reminder,
                        banner = banner,
                        errorMessage = str(R.string.task_detail_due_date_refresh_failed)
                    )
        }
    }

    private suspend fun rereadAfterReminderConflict(noteDraft: String) {
        val id = taskId ?: return
        when (val fresh = repository.getTask(id)) {
            is OwnerApiResult.Success ->
                _uiState.value =
                    readyFromTask(
                        task = fresh.value,
                        noteDraft = noteDraft,
                        errorMessage = str(R.string.task_detail_stale_reminder)
                    )
            else -> {
                val current = _uiState.value as? TaskDetailUiState.Ready
                _uiState.value =
                    current?.copy(
                        mutating = false,
                        errorMessage = str(R.string.task_detail_stale_reminder)
                    ) ?: TaskDetailUiState.Error(str(R.string.task_detail_stale_reminder))
            }
        }
    }

    private suspend fun rereadAfterTaskConflict(noteDraft: String) {
        val id = taskId ?: return
        when (val fresh = repository.getTask(id)) {
            is OwnerApiResult.Success ->
                _uiState.value =
                    readyFromTask(
                        task = fresh.value,
                        noteDraft = noteDraft,
                        errorMessage = str(R.string.task_detail_stale_etag)
                    )
            else -> {
                val current = _uiState.value as? TaskDetailUiState.Ready
                _uiState.value =
                    current?.copy(
                        mutating = false,
                        errorMessage = str(R.string.task_detail_stale_etag)
                    ) ?: TaskDetailUiState.Error(str(R.string.task_detail_stale_etag))
            }
        }
    }

    private suspend fun readyAfterTaskWrite(
        task: OwnerTask,
        noteDraft: String,
        banner: String
    ): TaskDetailUiState.Ready = readyFromTask(task = task, noteDraft = noteDraft, banner = banner)

    private suspend fun readyFromTask(
        task: OwnerTask,
        noteDraft: String = "",
        errorMessage: String? = null,
        banner: String? = null
    ): TaskDetailUiState.Ready {
        return when (val reminder = reminderRepository.getReminder(task.id)) {
            is OwnerApiResult.Success ->
                readyFromReminder(
                    task = task,
                    reminder = reminder.value,
                    noteDraft = noteDraft,
                    errorMessage = errorMessage,
                    banner = banner
                )
            else ->
                TaskDetailUiState.Ready(
                    task = task,
                    reminderEtag = null,
                    noteDraft = noteDraft,
                    errorMessage = errorMessage ?: str(R.string.task_detail_reminder_unavailable),
                    banner = banner
                )
        }
    }

    private fun readyFromReminder(
        task: OwnerTask,
        reminder: TaskReminderWire,
        noteDraft: String = "",
        errorMessage: String? = null,
        banner: String? = null
    ): TaskDetailUiState.Ready = TaskDetailUiState.Ready(
        task = task,
        reminderEtag = reminder.etag,
        reminderScheduleState = reminder.state,
        advanceEnabled = reminder.advanceEnabled,
        advanceDisposition = reminder.advance?.disposition,
        advanceOccurrenceLocalDate = reminder.advance?.occurrence?.localDate,
        noteDraft = noteDraft,
        errorMessage = errorMessage,
        banner = banner
    )

    private fun isReminderStale(result: OwnerApiResult.HttpError): Boolean =
        result.code == ErrorCode.PRECONDITION_FAILED ||
            result.code == ErrorCode.PRECONDITION_REQUIRED

    private enum class ReminderWriteKind {
        DEADLINE,
        ADVANCE
    }

    class Factory(
        private val application: Application,
        private val repository: TaskOwnerRepository,
        private val reminderRepository: ReminderOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskDetailViewModel::class.java)) {
                return TaskDetailViewModel(
                    application,
                    repository,
                    reminderRepository,
                    onSessionInvalidated
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
