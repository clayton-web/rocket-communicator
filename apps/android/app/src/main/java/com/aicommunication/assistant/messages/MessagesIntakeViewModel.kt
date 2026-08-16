package com.aicommunication.assistant.messages

import android.app.Application
import android.content.Intent
import androidx.annotation.StringRes
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
import kotlinx.coroutines.launch

/**
 * Device-local Messages intake and explicit Review with Rocket (D181).
 *
 * Notification arrival never uploads, interprets, or creates Tasks. Review POSTs the selected
 * eligible occurrence with a frozen Idempotency-Key, `sourceOccurrenceId`, `selectedText`, and
 * `observedAt` held in this ViewModel for the current attempt. Successful 0..N proposals are
 * handed to the existing S5 capture proposal surface. Review itself creates no Task.
 *
 * In-flight retry identity is in-memory only. Process death drops it: persisting selected text
 * would create a durable local Messages archive, which D181 forbids.
 */
class MessagesIntakeViewModel(
    application: Application,
    private val store: MessagesLocalReviewStore,
    private val access: MessagesNotificationAccess,
    private val shapeProbe: MessagesNotificationShapeProbe,
    private val repository: MessagesOwnerRepository,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private var observingStore = false
    private var selectedId: String? = null
    private val _uiState =
        MutableStateFlow<MessagesIntakeUiState>(MessagesIntakeUiState.CheckingAccess)
    val uiState: StateFlow<MessagesIntakeUiState> = _uiState.asStateFlow()

    private val _openReviewResult = MutableStateFlow<MessagesReviewReady?>(null)
    val openReviewResult: StateFlow<MessagesReviewReady?> = _openReviewResult.asStateFlow()

    /**
     * In-memory retry identity for the current explicit Review with Rocket attempt. Survives
     * configuration change with this ViewModel; a new Owner review action mints a new key.
     */
    private var pendingAttempt: MessagesReviewAttempt? = null
    private var reviewGuard = false

    init {
        publish()
    }

    fun refreshAccess() {
        publish()
        observeStore()
    }

    fun select(id: String) {
        val current = _uiState.value as? MessagesIntakeUiState.Ready
        if (current?.reviewing == true) return
        if (store.snapshot.value.eligible.none { it.id == id }) return
        if (pendingAttempt?.sourceOccurrenceId != id) {
            pendingAttempt = null
        }
        selectedId = id
        publish(
            reviewError = null,
            reviewConnectivityIssue = false,
            canRetryReview = false
        )
    }

    /**
     * Starts or retries Review with Rocket for the selected eligible item. The Idempotency-Key,
     * selected text, and `observedAt` are minted once per logical attempt and reused while that
     * attempt's outcome is still ambiguous. `observedAt` is the original notification instant.
     */
    fun reviewWithRocket() {
        val current = _uiState.value as? MessagesIntakeUiState.Ready ?: return
        val selectedId = current.selectedId ?: return
        if (!current.canReview && !current.canRetryReview) return
        if (current.reviewing || reviewGuard) return
        val selected = current.eligible.firstOrNull { it.id == selectedId } ?: return
        val observedAt = MessagesReviewObservedAt.fromPostedAtMs(selected.postedAtMs)
        val attempt =
            pendingAttempt?.takeIf { it.sourceOccurrenceId == selectedId }
                ?: MessagesReviewAttempt(
                    sourceOccurrenceId = selected.id,
                    selectedText = selected.text,
                    observedAt = observedAt,
                    idempotencyKey = MessagesOwnerRepository.newIdempotencyKey()
                ).also { pendingAttempt = it }
        reviewGuard = true
        publish(
            reviewing = true,
            reviewError = null,
            reviewConnectivityIssue = false,
            canRetryReview = false
        )
        viewModelScope.launch {
            val result =
                repository.createReview(
                    idempotencyKey = attempt.idempotencyKey,
                    sourceOccurrenceId = attempt.sourceOccurrenceId,
                    selectedText = attempt.selectedText,
                    observedAt = attempt.observedAt
                )
            handleReviewResult(attempt, result)
            reviewGuard = false
        }
    }

    fun consumeReviewResult() {
        _openReviewResult.value = null
    }

    fun accessSettingsIntent(): Intent = access.settingsIntent()

    private fun observeStore() {
        if (observingStore) return
        observingStore = true
        viewModelScope.launch {
            store.snapshot.collect { publish() }
        }
    }

    private fun publish(
        reviewing: Boolean? = null,
        reviewError: String? = UNCHANGED_ERROR,
        reviewConnectivityIssue: Boolean? = null,
        canRetryReview: Boolean? = null
    ) {
        if (!access.isEnabled()) {
            _uiState.value = MessagesIntakeUiState.AccessDisabled
            return
        }
        val snap = store.snapshot.value
        val previous = _uiState.value as? MessagesIntakeUiState.Ready
        val nextSelected = selectedId?.takeIf { id -> snap.eligible.any { it.id == id } }
        _uiState.value =
            MessagesIntakeUiState.Ready(
                eligible = snap.eligible,
                filtered = snap.filtered,
                listenerError = snap.listenerError != null,
                shapes = shapeProbe.recent(),
                selectedId = nextSelected,
                reviewing = reviewing ?: previous?.reviewing ?: false,
                reviewError =
                if (reviewError === UNCHANGED_ERROR) previous?.reviewError else reviewError,
                reviewConnectivityIssue =
                reviewConnectivityIssue ?: previous?.reviewConnectivityIssue ?: false,
                canRetryReview = canRetryReview ?: previous?.canRetryReview ?: false
            )
    }

    private fun handleReviewResult(
        attempt: MessagesReviewAttempt,
        result: OwnerApiResult<MessagesReviewResponseWire>
    ) {
        val outcome = MessagesReviewOutcome.classify(result)
        if (result is OwnerApiResult.Success) {
            // Presentation first, then drop the retry identity (D161 / D171 analogue).
            _openReviewResult.value =
                MessagesReviewReady(
                    sourceText = attempt.selectedText,
                    proposals = result.value.taskSuggestions
                )
            pendingAttempt = null
            publish(
                reviewing = false,
                reviewError = null,
                reviewConnectivityIssue = false,
                canRetryReview = false
            )
            return
        }
        if (!outcome.preservesAttempt) {
            pendingAttempt = null
        }
        if (outcome == MessagesReviewOutcome.UNAUTHORIZED) {
            onSessionInvalidated()
        }
        publish(
            reviewing = false,
            reviewError = reviewErrorMessage(result),
            reviewConnectivityIssue = outcome == MessagesReviewOutcome.CONNECTIVITY,
            canRetryReview = outcome.preservesAttempt
        )
    }

    private fun reviewErrorMessage(result: OwnerApiResult<*>): String = when (result) {
        OwnerApiResult.Connectivity -> string(R.string.error_connectivity)
        OwnerApiResult.NotConfigured -> string(R.string.error_auth_config)
        OwnerApiResult.Unauthorized -> string(R.string.messages_review_error_session)
        is OwnerApiResult.HttpError ->
            when (result.code) {
                ErrorCode.DEPENDENCY_UNAVAILABLE ->
                    string(R.string.messages_review_error_dependency)
                ErrorCode.NOT_FOUND -> string(R.string.messages_review_error_not_found)
                ErrorCode.DOMAIN_CONFLICT ->
                    result.message.ifBlank { string(R.string.messages_review_error_ineligible) }
                ErrorCode.IDEMPOTENCY_KEY_CONFLICT ->
                    string(R.string.messages_review_error_conflict)
                ErrorCode.VALIDATION_ERROR -> string(R.string.messages_review_error_validation)
                else ->
                    result.message.ifBlank { string(R.string.messages_review_error_generic) }
            }
        is OwnerApiResult.Unexpected ->
            result.message.ifBlank { string(R.string.messages_review_error_generic) }
        else -> string(R.string.messages_review_error_generic)
    }

    private fun string(@StringRes id: Int): String = getApplication<Application>().getString(id)

    class Factory(
        private val application: Application,
        private val store: MessagesLocalReviewStore,
        private val access: MessagesNotificationAccess,
        private val shapeProbe: MessagesNotificationShapeProbe,
        private val repository: MessagesOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(MessagesIntakeViewModel::class.java)) {
                return MessagesIntakeViewModel(
                    application,
                    store,
                    access,
                    shapeProbe,
                    repository,
                    onSessionInvalidated
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }

    private companion object {
        val UNCHANGED_ERROR = String()
    }
}
