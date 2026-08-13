package com.aicommunication.assistant.tasks

import android.app.Application
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
 * Owner Gmail intake and explicit Review with Rocket (S7, D161 / D179).
 *
 * Intake lists currently reviewable Gmail occurrences. Review POSTs the selected
 * `communicationEventId` with a frozen Idempotency-Key held in this ViewModel for the current
 * attempt. Successful 0..N proposals are handed to the existing S5 capture proposal surface.
 * Review itself creates no Task.
 */
class GmailIntakeViewModel(
    application: Application,
    private val repository: GmailOwnerRepository,
    private val onSessionInvalidated: () -> Unit
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<GmailIntakeUiState>(GmailIntakeUiState.Loading)
    val uiState: StateFlow<GmailIntakeUiState> = _uiState.asStateFlow()

    private val _openReviewResult = MutableStateFlow<GmailReviewReady?>(null)
    val openReviewResult: StateFlow<GmailReviewReady?> = _openReviewResult.asStateFlow()

    /**
     * In-memory retry identity for the current explicit Review with Rocket attempt. Survives
     * configuration change with this ViewModel; a new Owner review action mints a new key.
     */
    private var pendingAttempt: GmailReviewAttempt? = null
    private var reviewGuard = false

    fun load() {
        if ((_uiState.value as? GmailIntakeUiState.Ready)?.reviewing == true) return
        viewModelScope.launch {
            _uiState.value = GmailIntakeUiState.Loading
            when (val result = repository.listIntake()) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        GmailIntakeUiState.Ready(
                            items = result.value.items,
                            nextCursor = result.value.nextCursor
                        )
                OwnerApiResult.Unauthorized -> {
                    _uiState.value =
                        GmailIntakeUiState.Error(string(R.string.error_session_unavailable))
                    onSessionInvalidated()
                }
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        GmailIntakeUiState.Error(
                            message = string(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                OwnerApiResult.NotConfigured ->
                    _uiState.value =
                        GmailIntakeUiState.Error(string(R.string.error_auth_config))
                is OwnerApiResult.HttpError ->
                    _uiState.value =
                        GmailIntakeUiState.Error(
                            result.message.ifBlank { string(R.string.gmail_intake_error_generic) }
                        )
                is OwnerApiResult.Unexpected ->
                    _uiState.value =
                        GmailIntakeUiState.Error(
                            result.message.ifBlank { string(R.string.gmail_intake_error_generic) }
                        )
            }
        }
    }

    fun refresh() {
        val current = _uiState.value as? GmailIntakeUiState.Ready ?: return load()
        if (current.reviewing) return
        viewModelScope.launch {
            _uiState.value =
                current.copy(
                    refreshing = true,
                    errorMessage = null,
                    connectivityIssue = false
                )
            when (val result = repository.listIntake()) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        GmailIntakeUiState.Ready(
                            items = result.value.items,
                            nextCursor = result.value.nextCursor,
                            selectedId =
                            current.selectedId?.takeIf { id ->
                                result.value.items.any { it.id == id }
                            }
                        )
                OwnerApiResult.Unauthorized -> onSessionInvalidated()
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            refreshing = false,
                            errorMessage = string(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                else ->
                    _uiState.value =
                        current.copy(
                            refreshing = false,
                            errorMessage = string(R.string.gmail_intake_error_generic)
                        )
            }
        }
    }

    fun loadMore() {
        val current = _uiState.value as? GmailIntakeUiState.Ready ?: return
        val cursor = current.nextCursor ?: return
        if (current.loadingMore || current.reviewing) return
        viewModelScope.launch {
            _uiState.value = current.copy(loadingMore = true, errorMessage = null)
            when (val result = repository.listIntake(cursor = cursor)) {
                is OwnerApiResult.Success ->
                    _uiState.value =
                        GmailIntakeUiState.Ready(
                            items = current.items + result.value.items,
                            nextCursor = result.value.nextCursor,
                            selectedId = current.selectedId
                        )
                OwnerApiResult.Unauthorized -> onSessionInvalidated()
                OwnerApiResult.Connectivity ->
                    _uiState.value =
                        current.copy(
                            loadingMore = false,
                            errorMessage = string(R.string.error_connectivity),
                            connectivityIssue = true
                        )
                else ->
                    _uiState.value =
                        current.copy(
                            loadingMore = false,
                            errorMessage = string(R.string.gmail_intake_error_generic)
                        )
            }
        }
    }

    fun select(id: String) {
        val current = _uiState.value as? GmailIntakeUiState.Ready ?: return
        if (current.reviewing) return
        if (current.items.none { it.id == id }) return
        if (pendingAttempt?.communicationEventId != id) {
            pendingAttempt = null
        }
        _uiState.value =
            current.copy(
                selectedId = id,
                reviewError = null,
                reviewConnectivityIssue = false,
                canRetryReview = false
            )
    }

    /**
     * Starts or retries Review with Rocket for the selected message. The Idempotency-Key is
     * minted once per logical attempt and reused while that attempt's outcome is still ambiguous.
     */
    fun reviewWithRocket() {
        val current = _uiState.value as? GmailIntakeUiState.Ready ?: return
        val selectedId = current.selectedId ?: return
        if (!current.canReview && !current.canRetryReview) return
        if (current.reviewing || reviewGuard) return
        val selected = current.items.firstOrNull { it.id == selectedId } ?: return
        val attempt =
            pendingAttempt?.takeIf { it.communicationEventId == selectedId }
                ?: GmailReviewAttempt(
                    communicationEventId = selectedId,
                    idempotencyKey = GmailOwnerRepository.newIdempotencyKey()
                ).also { pendingAttempt = it }
        reviewGuard = true
        _uiState.value =
            current.copy(
                reviewing = true,
                reviewError = null,
                reviewConnectivityIssue = false,
                canRetryReview = false
            )
        viewModelScope.launch {
            val result =
                repository.createReview(
                    idempotencyKey = attempt.idempotencyKey,
                    communicationEventId = attempt.communicationEventId
                )
            handleReviewResult(selected, result)
            reviewGuard = false
        }
    }

    fun consumeReviewResult() {
        _openReviewResult.value = null
    }

    private fun handleReviewResult(
        selected: GmailIntakeItemWire,
        result: OwnerApiResult<GmailReviewResponseWire>
    ) {
        val outcome = GmailReviewOutcome.classify(result)
        if (result is OwnerApiResult.Success) {
            // Presentation first, then drop the retry identity (D161 / D171 analogue).
            _openReviewResult.value =
                GmailReviewReady(
                    sourceText = selected.reviewSourceText(),
                    proposals = result.value.taskSuggestions
                )
            pendingAttempt = null
            val current = _uiState.value as? GmailIntakeUiState.Ready ?: return
            _uiState.value =
                current.copy(reviewing = false, reviewError = null, canRetryReview = false)
            return
        }
        if (!outcome.preservesAttempt) {
            pendingAttempt = null
        }
        if (outcome == GmailReviewOutcome.UNAUTHORIZED) {
            onSessionInvalidated()
        }
        val current = _uiState.value as? GmailIntakeUiState.Ready ?: return
        _uiState.value =
            current.copy(
                reviewing = false,
                reviewError = reviewErrorMessage(result),
                reviewConnectivityIssue = outcome == GmailReviewOutcome.CONNECTIVITY,
                canRetryReview = outcome.preservesAttempt
            )
    }

    private fun reviewErrorMessage(result: OwnerApiResult<*>): String = when (result) {
        OwnerApiResult.Connectivity -> string(R.string.error_connectivity)
        OwnerApiResult.NotConfigured -> string(R.string.error_auth_config)
        OwnerApiResult.Unauthorized -> string(R.string.gmail_review_error_session)
        is OwnerApiResult.HttpError ->
            when (result.code) {
                ErrorCode.DEPENDENCY_UNAVAILABLE ->
                    string(R.string.gmail_review_error_dependency)
                ErrorCode.NOT_FOUND -> string(R.string.gmail_review_error_not_found)
                ErrorCode.DOMAIN_CONFLICT ->
                    result.message.ifBlank { string(R.string.gmail_review_error_ineligible) }
                ErrorCode.IDEMPOTENCY_KEY_CONFLICT ->
                    string(R.string.gmail_review_error_conflict)
                ErrorCode.VALIDATION_ERROR -> string(R.string.gmail_review_error_validation)
                else ->
                    result.message.ifBlank { string(R.string.gmail_review_error_generic) }
            }
        is OwnerApiResult.Unexpected ->
            result.message.ifBlank { string(R.string.gmail_review_error_generic) }
        else -> string(R.string.gmail_review_error_generic)
    }

    private fun string(@StringRes id: Int): String = getApplication<Application>().getString(id)

    class Factory(
        private val application: Application,
        private val repository: GmailOwnerRepository,
        private val onSessionInvalidated: () -> Unit
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(GmailIntakeViewModel::class.java)) {
                return GmailIntakeViewModel(
                    application,
                    repository,
                    onSessionInvalidated
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}

internal data class GmailReviewAttempt(
    val communicationEventId: String,
    val idempotencyKey: String
)
