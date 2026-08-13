package com.aicommunication.assistant.capture

import android.app.Application
import androidx.annotation.StringRes
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.tasks.RecipientOwnerRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Owner manual capture over the shared interpretation route (S3.3b / S5.2, D171 / D176).
 *
 * Capture sends the frozen tuple owned by [ManualCaptureUseCase] to
 * `POST /api/v1/manual-captures` and shows the returned proposals. Capture itself still creates
 * no Task. Accept is an explicit later decision: affirmative Me / saved-Recipient responsibility,
 * the existing approve mutation, then navigation to the canonical Task.
 */
class TaskCaptureViewModel(
    application: Application,
    private val manualCapture: ManualCaptureUseCase,
    private val proposalRepository: ProposalOwnerRepository,
    private val recipientRepository: RecipientOwnerRepository,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<CaptureUiState>(CaptureUiState.Editing())
    val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

    private val _openApprovedTaskId = MutableStateFlow<String?>(null)
    val openApprovedTaskId: StateFlow<String?> = _openApprovedTaskId.asStateFlow()

    /** In-memory handle on the persisted tuple; the store remains the durable copy. */
    private var pending: PendingCaptureOperation? = null

    private var approveGuard = false

    /**
     * Restores an unresolved capture when the Owner enters Capture, including after process death.
     * Never resends: the Owner chooses Retry or Discard. An expired record is not a pending
     * capture, so [ManualCaptureUseCase.pendingCapture] returning null means normal editing.
     */
    fun restorePending() {
        val current = _uiState.value as? CaptureUiState.Editing ?: return
        if (current.submitting || current.draft.isNotEmpty()) {
            return
        }
        val operation = manualCapture.pendingCapture() ?: return
        pending = operation
        _uiState.value = CaptureUiState.Recovery(rawInput = operation.rawInput)
    }

    fun onDraftChanged(value: String) {
        when (val current = _uiState.value) {
            is CaptureUiState.Editing -> {
                if (current.submitting) return
                discardPendingIdentity()
                _uiState.value = current.copy(draft = value, errorMessage = null)
            }
            is CaptureUiState.Recovery -> {
                if (current.submitting || value == current.rawInput) return
                // D171: changed text is a different capture. It must never be resent under the
                // old Idempotency-Key, so the frozen tuple is dropped here.
                discardPendingIdentity()
                _uiState.value = CaptureUiState.Editing(draft = value)
            }
            is CaptureUiState.Proposals -> Unit
        }
    }

    fun save() {
        val current = _uiState.value as? CaptureUiState.Editing ?: return
        if (current.submitting) return
        val operation = manualCapture.beginCapture(current.draft) ?: return
        pending = operation
        _uiState.value = current.copy(submitting = true, errorMessage = null)
        viewModelScope.launch { send(operation) }
    }

    /** Replays the stored tuple verbatim so the server can return a committed interpretation. */
    fun retry() {
        val current = _uiState.value as? CaptureUiState.Recovery ?: return
        if (current.submitting) return
        val operation = pending ?: manualCapture.pendingCapture()
        if (operation == null) {
            _uiState.value = CaptureUiState.Editing(draft = current.rawInput)
            return
        }
        pending = operation
        _uiState.value =
            current.copy(submitting = true, errorMessage = null, connectivityIssue = false)
        viewModelScope.launch { send(operation) }
    }

    fun discard() {
        resetToEditing()
    }

    /**
     * Leaving Capture drops a finished result and an untouched draft, but never an unresolved
     * pending capture — that has to still be recoverable when the Owner comes back.
     */
    fun onLeaveCapture() {
        if (_uiState.value is CaptureUiState.Recovery) return
        if (proposalsBusy()) return
        _uiState.value = CaptureUiState.Editing()
    }

    fun captureAnother() {
        if (proposalsBusy()) return
        resetToEditing()
    }

    /** Reopens the capture Rocket found nothing actionable in, under a fresh identity. */
    fun rephrase() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        if (current.accept?.busy == true) return
        resetToEditing(current.capturedText)
    }

    fun openAccept(proposalId: String) {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        if (current.accept?.busy == true) return
        val proposal = current.proposals.firstOrNull { it.id == proposalId } ?: return
        if (!proposal.isAcceptable) return
        if (current.accept?.proposalId == proposalId) return
        _uiState.value =
            current.copy(
                accept =
                ProposalAcceptInteraction(
                    proposalId = proposalId,
                    recipientsLoading = true
                ),
                notice = null
            )
        viewModelScope.launch { loadRecipients(proposalId) }
    }

    fun cancelAccept() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.busy) return
        _uiState.value = current.copy(accept = null)
    }

    fun selectOwnerResponsibility() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.busy || accept.recoveryReadFailed) return
        _uiState.value =
            current.copy(
                accept =
                accept.copy(
                    selectedResponsibility = ProposalResponsibility.Owner,
                    message = null
                )
            )
    }

    fun selectRecipientResponsibility(recipientId: String) {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.busy || accept.recoveryReadFailed) return
        if (accept.recipients.none { it.id == recipientId }) return
        _uiState.value =
            current.copy(
                accept =
                accept.copy(
                    selectedResponsibility = ProposalResponsibility.Recipient(recipientId),
                    message = null
                )
            )
    }

    fun confirmAccept() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        val responsibility = accept.selectedResponsibility ?: return
        if (!accept.canConfirm || approveGuard) return
        val proposal = current.proposals.firstOrNull { it.id == accept.proposalId } ?: return
        approveGuard = true
        _uiState.value =
            current.copy(
                accept =
                accept.copy(
                    approving = true,
                    recoveryReadFailed = false,
                    message = null
                ),
                notice = null
            )
        viewModelScope.launch {
            val result =
                proposalRepository.approve(
                    suggestionId = proposal.id,
                    etag = proposal.etag,
                    responsibility = responsibility
                )
            handleApproveResult(proposal.id, result)
            approveGuard = false
        }
    }

    fun retryAcceptRecipients() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.busy || accept.recipientsLoading) return
        _uiState.value =
            current.copy(
                accept = accept.copy(recipientsLoading = true, recipientsError = null)
            )
        viewModelScope.launch { loadRecipients(accept.proposalId) }
    }

    fun retryAcceptRecovery() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (!accept.recoveryReadFailed || accept.busy || approveGuard) return
        viewModelScope.launch { recoverFromCanonical(accept.proposalId) }
    }

    fun consumeOpenApprovedTask() {
        _openApprovedTaskId.value = null
    }

    private suspend fun send(operation: PendingCaptureOperation) {
        val result = manualCapture.submit(operation)
        if (result is OwnerApiResult.Success) {
            showResult(operation, result.value)
            return
        }
        showFailure(operation, result, ManualCaptureOutcome.classify(result))
    }

    private fun showResult(
        operation: PendingCaptureOperation,
        response: ManualCaptureResponseWire
    ) {
        // Order matters (D171): the result reaches presentation state first, and only then does
        // the retry identity go away. Clearing first would leave a crash window where the server
        // committed an interpretation the Owner can neither see nor replay.
        _uiState.value =
            CaptureUiState.Proposals(
                capturedText = operation.rawInput,
                proposals = response.taskSuggestions
            )
        pending = null
        manualCapture.discardPending()
    }

    private fun showFailure(
        operation: PendingCaptureOperation,
        result: OwnerApiResult<*>,
        outcome: ManualCaptureOutcome
    ) {
        when (outcome) {
            // Terminal for this tuple: the use case already cleared the unusable record.
            ManualCaptureOutcome.VALIDATION_FAILURE -> {
                pending = null
                _uiState.value =
                    CaptureUiState.Editing(
                        draft = operation.rawInput,
                        errorMessage = string(R.string.capture_error_validation)
                    )
            }
            ManualCaptureOutcome.IDEMPOTENCY_CONFLICT -> {
                pending = null
                _uiState.value =
                    CaptureUiState.Editing(
                        draft = operation.rawInput,
                        errorMessage = string(R.string.capture_error_conflict)
                    )
            }
            ManualCaptureOutcome.CONNECTIVITY ->
                _uiState.value =
                    CaptureUiState.Recovery(
                        rawInput = operation.rawInput,
                        errorMessage = string(R.string.error_connectivity),
                        connectivityIssue = true
                    )
            ManualCaptureOutcome.DEPENDENCY_UNAVAILABLE ->
                _uiState.value =
                    CaptureUiState.Recovery(
                        rawInput = operation.rawInput,
                        errorMessage = string(R.string.capture_error_dependency)
                    )
            ManualCaptureOutcome.UNAUTHORIZED -> {
                // The capture survives session recovery; the same tuple retries after sign-in.
                _uiState.value =
                    CaptureUiState.Recovery(
                        rawInput = operation.rawInput,
                        errorMessage = string(R.string.capture_error_session)
                    )
                onSessionInvalidated()
            }
            ManualCaptureOutcome.UNEXPECTED, ManualCaptureOutcome.SUCCESS ->
                _uiState.value =
                    CaptureUiState.Recovery(
                        rawInput = operation.rawInput,
                        errorMessage = unexpectedMessage(result)
                    )
        }
    }

    private suspend fun loadRecipients(forProposalId: String) {
        val result = recipientRepository.listActiveRecipients()
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.proposalId != forProposalId) return
        when (result) {
            is OwnerApiResult.Success ->
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipients = result.value.items,
                            recipientsLoading = false,
                            recipientsError = null
                        )
                    )
            OwnerApiResult.Unauthorized -> {
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipientsLoading = false,
                            recipientsError = string(R.string.capture_error_session)
                        )
                    )
                onSessionInvalidated()
            }
            OwnerApiResult.Connectivity ->
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipientsLoading = false,
                            recipientsError = string(R.string.error_connectivity)
                        )
                    )
            OwnerApiResult.NotConfigured ->
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipientsLoading = false,
                            recipientsError = string(R.string.error_auth_config)
                        )
                    )
            is OwnerApiResult.HttpError ->
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipientsLoading = false,
                            recipientsError =
                            result.message.ifBlank {
                                string(R.string.capture_accept_recipients_error)
                            }
                        )
                    )
            is OwnerApiResult.Unexpected ->
                _uiState.value =
                    current.copy(
                        accept =
                        accept.copy(
                            recipientsLoading = false,
                            recipientsError =
                            result.message.ifBlank {
                                string(R.string.capture_accept_recipients_error)
                            }
                        )
                    )
        }
    }

    private suspend fun handleApproveResult(
        proposalId: String,
        result: OwnerApiResult<ApproveProposalResult>
    ) {
        when (result) {
            is OwnerApiResult.Success ->
                completeAccept(result.value.suggestion, result.value.task.id)
            OwnerApiResult.Unauthorized -> {
                showAcceptError(string(R.string.capture_accept_error_session))
                onSessionInvalidated()
            }
            OwnerApiResult.NotConfigured ->
                showAcceptError(string(R.string.error_auth_config))
            OwnerApiResult.Connectivity -> recoverFromCanonical(proposalId)
            is OwnerApiResult.Unexpected -> recoverFromCanonical(proposalId)
            is OwnerApiResult.HttpError -> {
                if (isAmbiguousApproveOutcome(result)) {
                    recoverFromCanonical(proposalId)
                } else {
                    showAcceptError(definiteApproveMessage(result))
                }
            }
        }
    }

    private suspend fun recoverFromCanonical(proposalId: String) {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        if (accept.proposalId != proposalId) return
        _uiState.value =
            current.copy(
                accept =
                accept.copy(
                    approving = false,
                    recovering = true,
                    recoveryReadFailed = false,
                    message = null
                )
            )
        when (val read = proposalRepository.getSuggestion(proposalId)) {
            is OwnerApiResult.Success -> applyCanonicalSuggestion(read.value)
            OwnerApiResult.Unauthorized -> {
                showAcceptError(
                    message = string(R.string.capture_accept_error_session),
                    recoveryReadFailed = true
                )
                onSessionInvalidated()
            }
            else ->
                showAcceptError(
                    message = string(R.string.capture_accept_recovery_failed),
                    recoveryReadFailed = true
                )
        }
    }

    private fun applyCanonicalSuggestion(suggestion: TaskSuggestionWire) {
        val approvedTaskId = suggestion.approvedTaskId?.takeIf { it.isNotBlank() }
        if (approvedTaskId != null) {
            completeAccept(suggestion, approvedTaskId)
            return
        }
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        val updated = current.replaceProposal(suggestion)
        if (!suggestion.isAcceptable) {
            _uiState.value =
                updated.copy(
                    accept = null,
                    notice = string(R.string.capture_accept_already_terminal)
                )
            return
        }
        _uiState.value =
            updated.copy(
                accept =
                ProposalAcceptInteraction(
                    proposalId = suggestion.id,
                    recipients = accept.recipients,
                    recipientsError = accept.recipientsError,
                    message = string(R.string.capture_accept_still_pending)
                )
            )
    }

    private fun completeAccept(suggestion: TaskSuggestionWire, taskId: String) {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        _uiState.value =
            current.replaceProposal(suggestion).copy(accept = null, notice = null)
        _openApprovedTaskId.value = taskId
    }

    private fun showAcceptError(message: String, recoveryReadFailed: Boolean = false) {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        val accept = current.accept ?: return
        _uiState.value =
            current.copy(
                accept =
                accept.copy(
                    approving = false,
                    recovering = false,
                    recoveryReadFailed = recoveryReadFailed,
                    message = message
                )
            )
    }

    private fun definiteApproveMessage(error: OwnerApiResult.HttpError): String =
        when (error.code) {
            ErrorCode.VALIDATION_ERROR -> string(R.string.capture_accept_error_validation)
            ErrorCode.NOT_FOUND -> string(R.string.capture_accept_error_not_found)
            else -> error.message.ifBlank { string(R.string.capture_accept_error_generic) }
        }

    private fun resetToEditing(draft: String = "") {
        pending = null
        manualCapture.discardPending()
        _openApprovedTaskId.value = null
        _uiState.value = CaptureUiState.Editing(draft = draft)
    }

    private fun discardPendingIdentity() {
        if (pending == null) return
        pending = null
        manualCapture.discardPending()
    }

    private fun proposalsBusy(): Boolean {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return false
        return current.accept?.busy == true
    }

    private fun unexpectedMessage(result: OwnerApiResult<*>): String = when (result) {
        OwnerApiResult.NotConfigured -> string(R.string.error_auth_config)
        is OwnerApiResult.Unexpected ->
            result.message.ifBlank { string(R.string.capture_error_generic) }
        is OwnerApiResult.HttpError ->
            result.message.ifBlank { string(R.string.capture_error_generic) }
        else -> string(R.string.capture_error_generic)
    }

    private fun string(@StringRes id: Int): String = getApplication<Application>().getString(id)

    class Factory(
        private val application: Application,
        private val manualCapture: ManualCaptureUseCase,
        private val proposalRepository: ProposalOwnerRepository,
        private val recipientRepository: RecipientOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskCaptureViewModel::class.java)) {
                return TaskCaptureViewModel(
                    application,
                    manualCapture,
                    proposalRepository,
                    recipientRepository,
                    onSessionInvalidated
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}

internal val TaskSuggestionWire.isAcceptable: Boolean
    get() = status == "pending" && approvedTaskId.isNullOrBlank()

internal fun CaptureUiState.Proposals.replaceProposal(
    updated: TaskSuggestionWire
): CaptureUiState.Proposals = copy(
    proposals = proposals.map { proposal ->
        if (proposal.id == updated.id) updated else proposal
    }
)

internal fun isAmbiguousApproveOutcome(result: OwnerApiResult.HttpError): Boolean =
    when (result.code) {
        ErrorCode.PRECONDITION_FAILED,
        ErrorCode.INVALID_STATE_TRANSITION,
        ErrorCode.DEPENDENCY_UNAVAILABLE -> true
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.NOT_FOUND,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.PRECONDITION_REQUIRED -> false
        else -> result.httpStatus >= 500
    }
