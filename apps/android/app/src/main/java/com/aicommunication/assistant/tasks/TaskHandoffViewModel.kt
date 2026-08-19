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
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class TaskHandoffViewModel(
    application: Application,
    private val taskRepository: TaskOwnerRepository,
    private val recipientRepository: RecipientOwnerRepository,
    private val gmailRepository: GmailOwnerRepository,
    private val pendingStore: PendingHandoffStore,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<HandoffUiState>(HandoffUiState.Loading)
    val uiState: StateFlow<HandoffUiState> = _uiState.asStateFlow()

    private var taskId: String? = null
    private var submitGuard = false

    private fun str(id: Int): String = getApplication<Application>().getString(id)

    private fun str(id: Int, vararg args: Any): String =
        getApplication<Application>().getString(id, *args)

    fun load(id: String) {
        taskId = id
        viewModelScope.launch {
            _uiState.value = HandoffUiState.Loading
            val taskResult = taskRepository.getTask(id)
            val recipientsResult = recipientRepository.listActiveRecipients()
            val connectionResult = gmailRepository.getConnection()

            if (taskResult is OwnerApiResult.Unauthorized ||
                recipientsResult is OwnerApiResult.Unauthorized ||
                connectionResult is OwnerApiResult.Unauthorized
            ) {
                _uiState.value =
                    HandoffUiState.Error(str(R.string.error_session_unavailable))
                onSessionInvalidated()
                return@launch
            }

            if (taskResult is OwnerApiResult.Connectivity ||
                recipientsResult is OwnerApiResult.Connectivity ||
                connectionResult is OwnerApiResult.Connectivity
            ) {
                _uiState.value =
                    HandoffUiState.Error(
                        message = str(R.string.error_connectivity),
                        connectivityIssue = true
                    )
                return@launch
            }

            val task =
                (taskResult as? OwnerApiResult.Success)?.value
                    ?: run {
                        _uiState.value =
                            HandoffUiState.Error(str(R.string.tasks_error_generic))
                        return@launch
                    }

            val recipients =
                (recipientsResult as? OwnerApiResult.Success)?.value?.items.orEmpty()
            val connection = (connectionResult as? OwnerApiResult.Success)?.value

            var pending = pendingStore.read(id)
            if (pending != null && pendingStore.isExpired(pending) && task.isAssigned) {
                pendingStore.clear(id)
                pending = null
            }

            _uiState.value =
                HandoffUiState.Ready(
                    task = task,
                    recipients = recipients,
                    selectedRecipientId = pending?.recipientId.orEmpty(),
                    connection = connection,
                    pending = pending,
                    showRetryAfterReconsent = pending?.reconsentPending == true,
                    successDeliveryPath = successfulAssignmentPath(task),
                    banner = assignmentBanner(task),
                    bannerTone = assignmentBannerTone(task)
                )
        }
    }

    fun selectRecipient(id: String) {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        if (!current.submitting) {
            _uiState.value = current.copy(selectedRecipientId = id, errorMessage = null)
        }
    }

    fun openConfirm() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        if (current.canConfirm) {
            _uiState.value = current.copy(confirming = true, errorMessage = null)
        }
    }

    fun closeConfirm() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        if (!current.submitting) {
            _uiState.value = current.copy(confirming = false)
        }
    }

    fun confirmHandoff() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        val recipient = current.selectedRecipient ?: return
        if (!current.canConfirm || submitGuard) return

        val operation =
            current.pending?.takeIf {
                it.recipientId == recipient.id && !pendingStore.isExpired(it)
            }
                ?: PendingHandoffOperation(
                    taskId = current.task.id,
                    recipientId = recipient.id,
                    idempotencyKey = TaskOwnerRepository.newIdempotencyKey(),
                    originalIfMatch = current.task.etag,
                    createdAt = Instant.now().toString()
                )

        pendingStore.write(operation)
        submitGuard = true
        viewModelScope.launch {
            _uiState.value =
                current.copy(
                    confirming = false,
                    submitting = true,
                    pending = operation,
                    errorMessage = null,
                    connectivityIssue = false,
                    banner = null
                )
            executeHandoff(operation)
            submitGuard = false
        }
    }

    fun retryOrCheck() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        val pending = current.pending ?: return
        if (submitGuard) return
        submitGuard = true
        viewModelScope.launch {
            _uiState.value =
                current.copy(submitting = true, errorMessage = null, connectivityIssue = false)
            executeHandoff(pending)
            submitGuard = false
        }
    }

    fun markReconsentPending() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        val pending = current.pending ?: return
        val updated = pending.copy(
            reconsentPending = true,
            lastOutcomeCategory = "reconsent_required"
        )
        pendingStore.write(updated)
        _uiState.value =
            current.copy(
                pending = updated,
                showRetryAfterReconsent = true,
                banner =
                str(R.string.handoff_reconsent_instructions),
                bannerTone = HandoffUiState.BannerTone.Warning
            )
    }

    fun onCreateNameChanged(value: String) {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        if (!current.creatingRecipient) {
            _uiState.value = current.copy(createName = value, errorMessage = null)
        }
    }

    fun onCreateEmailChanged(value: String) {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        if (!current.creatingRecipient) {
            _uiState.value = current.copy(createEmail = value, errorMessage = null)
        }
    }

    fun createRecipient() {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        val name = current.createName.trim()
        val email = current.createEmail.trim()
        if (name.isEmpty() || email.isEmpty() || current.creatingRecipient) return
        viewModelScope.launch {
            _uiState.value = current.copy(creatingRecipient = true, errorMessage = null)
            when (val result = recipientRepository.createRecipient(name, email)) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        current.copy(
                            creatingRecipient = false,
                            recipients = current.recipients + result.value,
                            selectedRecipientId = result.value.id,
                            createName = "",
                            createEmail = "",
                            banner =
                            str(R.string.handoff_recipient_created),
                            bannerTone = HandoffUiState.BannerTone.Info
                        )
                OwnerApiResult.Unauthorized -> {
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            creatingRecipient = false,
                            errorMessage =
                            str(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                is OwnerApiResult.HttpError ->
                    _uiState.value =
                        current.copy(
                            creatingRecipient = false,
                            errorMessage =
                            result.message.ifBlank {
                                str(R.string.tasks_error_generic)
                            }
                        )
                else ->
                    _uiState.value =
                        current.copy(
                            creatingRecipient = false,
                            errorMessage =
                            str(R.string.tasks_error_generic)
                        )
            }
        }
    }

    private suspend fun executeHandoff(operation: PendingHandoffOperation) {
        val current = _uiState.value as? HandoffUiState.Ready ?: return
        when (
            val result =
                taskRepository.handoffTask(
                    taskId = operation.taskId,
                    ifMatch = operation.originalIfMatch,
                    idempotencyKey = operation.idempotencyKey,
                    recipientId = operation.recipientId
                )
        ) {
            is OwnerApiResult.Success -> {
                pendingStore.clear(operation.taskId)
                val task = result.value.task.toOwnerTask()
                val message =
                    if (result.value.idempotentReplay) {
                        str(R.string.handoff_replay_success)
                    } else {
                        str(
                            R.string.handoff_success,
                            result.value.recipient.displayName
                        )
                    }
                _uiState.value =
                    current.copy(
                        task = task,
                        submitting = false,
                        pending = null,
                        showRetryAfterReconsent = false,
                        successDeliveryPath = result.value.deliveryPath,
                        banner = message,
                        bannerTone = HandoffUiState.BannerTone.Success,
                        errorMessage = null
                    )
            }
            OwnerApiResult.Unauthorized -> {
                _uiState.value =
                    current.copy(
                        submitting = false,
                        errorMessage =
                        str(R.string.error_session_unavailable)
                    )
                onSessionInvalidated()
            }
            OwnerApiResult.Connectivity -> {
                val updated =
                    operation.copy(lastOutcomeCategory = "ambiguous")
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        connectivityIssue = true,
                        banner =
                        str(R.string.handoff_ambiguous),
                        bannerTone = HandoffUiState.BannerTone.Warning,
                        errorMessage =
                        str(R.string.error_connectivity)
                    )
            }
            OwnerApiResult.NotConfigured ->
                _uiState.value =
                    current.copy(
                        submitting = false,
                        errorMessage =
                        str(R.string.error_auth_config)
                    )
            is OwnerApiResult.HttpError -> applyHandoffHttpError(current, operation, result)
            is OwnerApiResult.Unexpected -> {
                val updated = operation.copy(lastOutcomeCategory = "unknown")
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        banner =
                        str(R.string.handoff_ambiguous),
                        bannerTone = HandoffUiState.BannerTone.Warning,
                        errorMessage =
                        result.message.ifBlank {
                            str(R.string.tasks_error_generic)
                        }
                    )
            }
        }
    }

    private suspend fun applyHandoffHttpError(
        current: HandoffUiState.Ready,
        operation: PendingHandoffOperation,
        result: OwnerApiResult.HttpError
    ) {
        when (result.code) {
            ErrorCode.HANDOFF_IN_PROGRESS -> {
                val updated = operation.copy(lastOutcomeCategory = "in_progress")
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        banner =
                        str(R.string.handoff_in_progress),
                        bannerTone = HandoffUiState.BannerTone.Warning
                    )
            }
            ErrorCode.GMAIL_SEND_SCOPE_REQUIRED -> {
                val updated =
                    operation.copy(
                        lastOutcomeCategory = "reconsent_required",
                        reconsentPending = true
                    )
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        showRetryAfterReconsent = true,
                        banner =
                        str(R.string.handoff_reconsent_instructions),
                        bannerTone = HandoffUiState.BannerTone.Warning
                    )
            }
            ErrorCode.GMAIL_NOT_CONNECTED -> {
                val updated = operation.copy(lastOutcomeCategory = "not_connected")
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        banner =
                        str(R.string.handoff_gmail_not_connected),
                        bannerTone = HandoffUiState.BannerTone.Error
                    )
            }
            ErrorCode.PRECONDITION_FAILED -> {
                when (val fresh = taskRepository.getTask(operation.taskId)) {
                    is OwnerApiResult.Success -> {
                        if (fresh.value.canReturnFailedAssignmentToOwner) {
                            pendingStore.clear(operation.taskId)
                            _uiState.value =
                                current.copy(
                                    task = fresh.value,
                                    submitting = false,
                                    pending = null,
                                    successDeliveryPath = null,
                                    banner = assignmentBanner(fresh.value),
                                    bannerTone = assignmentBannerTone(fresh.value)
                                )
                        } else if (fresh.value.isAssigned) {
                            pendingStore.clear(operation.taskId)
                            _uiState.value =
                                current.copy(
                                    task = fresh.value,
                                    submitting = false,
                                    pending = null,
                                    successDeliveryPath = fresh.value.deliveryStatus,
                                    banner =
                                    str(R.string.handoff_already_assigned),
                                    bannerTone = HandoffUiState.BannerTone.Success
                                )
                        } else {
                            val rotated =
                                operation.copy(
                                    originalIfMatch = fresh.value.etag,
                                    lastOutcomeCategory = "stale"
                                )
                            pendingStore.write(rotated)
                            _uiState.value =
                                current.copy(
                                    task = fresh.value,
                                    submitting = false,
                                    pending = rotated,
                                    banner =
                                    str(R.string.task_detail_stale_etag),
                                    bannerTone = HandoffUiState.BannerTone.Warning
                                )
                        }
                    }
                    else ->
                        _uiState.value =
                            current.copy(
                                submitting = false,
                                errorMessage =
                                str(R.string.task_detail_stale_etag)
                            )
                }
            }
            ErrorCode.DEPENDENCY_UNAVAILABLE, ErrorCode.HANDOFF_DELIVERY_FAILED -> {
                val ambiguous =
                    result.httpStatus >= 500 ||
                        result.code == ErrorCode.DEPENDENCY_UNAVAILABLE
                val category = if (ambiguous) "ambiguous" else "retryable_failure"
                val updated = operation.copy(lastOutcomeCategory = category)
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        banner =
                        if (category == "ambiguous") {
                            str(R.string.handoff_ambiguous)
                        } else {
                            result.message.ifBlank {
                                str(R.string.handoff_failed)
                            }
                        },
                        bannerTone = HandoffUiState.BannerTone.Warning,
                        errorMessage =
                        result.message.takeIf { category != "ambiguous" }
                    )
            }
            else -> {
                val updated = operation.copy(lastOutcomeCategory = "permanent_failure")
                pendingStore.write(updated)
                _uiState.value =
                    current.copy(
                        submitting = false,
                        pending = updated,
                        bannerTone = HandoffUiState.BannerTone.Error,
                        errorMessage =
                        result.message.ifBlank {
                            str(R.string.handoff_failed)
                        }
                    )
            }
        }
    }

    private fun successfulAssignmentPath(task: OwnerTask): String? =
        if (task.isAssigned && !task.canReturnFailedAssignmentToOwner) {
            task.deliveryStatus
        } else {
            null
        }

    private fun assignmentBanner(task: OwnerTask): String? =
        when {
            task.canReturnFailedAssignmentToOwner -> str(R.string.handoff_delivery_failed)
            task.isAssigned -> str(R.string.handoff_already_assigned)
            else -> null
        }

    private fun assignmentBannerTone(task: OwnerTask): HandoffUiState.BannerTone =
        when {
            task.canReturnFailedAssignmentToOwner -> HandoffUiState.BannerTone.Warning
            task.isAssigned -> HandoffUiState.BannerTone.Success
            else -> HandoffUiState.BannerTone.Info
        }

    class Factory(
        private val application: Application,
        private val taskRepository: TaskOwnerRepository,
        private val recipientRepository: RecipientOwnerRepository,
        private val gmailRepository: GmailOwnerRepository,
        private val pendingStore: PendingHandoffStore,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskHandoffViewModel::class.java)) {
                return TaskHandoffViewModel(
                    application,
                    taskRepository,
                    recipientRepository,
                    gmailRepository,
                    pendingStore,
                    onSessionInvalidated
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
