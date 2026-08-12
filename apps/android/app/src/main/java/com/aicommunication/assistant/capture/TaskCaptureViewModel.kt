package com.aicommunication.assistant.capture

import android.app.Application
import androidx.annotation.StringRes
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.network.OwnerApiResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Owner manual capture over the shared interpretation route (S3.3b, D171).
 *
 * Capture no longer creates a Task. It sends the frozen tuple owned by [ManualCaptureUseCase] to
 * `POST /api/v1/manual-captures` and shows the returned proposals read-only: Rocket proposes, the
 * Owner decides later. Idempotency key, capturedAt, and timezone are never minted here.
 */
class TaskCaptureViewModel(
    application: Application,
    private val manualCapture: ManualCaptureUseCase,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<CaptureUiState>(CaptureUiState.Editing())
    val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

    /** In-memory handle on the persisted tuple; the store remains the durable copy. */
    private var pending: PendingCaptureOperation? = null

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
        _uiState.value = CaptureUiState.Editing()
    }

    fun captureAnother() {
        resetToEditing()
    }

    /** Reopens the capture Rocket found nothing actionable in, under a fresh identity. */
    fun rephrase() {
        val current = _uiState.value as? CaptureUiState.Proposals ?: return
        resetToEditing(current.capturedText)
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

    private fun resetToEditing(draft: String = "") {
        pending = null
        manualCapture.discardPending()
        _uiState.value = CaptureUiState.Editing(draft = draft)
    }

    private fun discardPendingIdentity() {
        if (pending == null) return
        pending = null
        manualCapture.discardPending()
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
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TaskCaptureViewModel::class.java)) {
                return TaskCaptureViewModel(application, manualCapture, onSessionInvalidated) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
