package com.aicommunication.assistant.auth

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class OwnerAuthViewModel(
    application: Application,
    private val repository: OwnerAuthRepository
) : AndroidViewModel(application) {
    private val _uiState = MutableStateFlow<AuthUiState>(AuthUiState.Loading)
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        restore()
    }

    fun restore() {
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            _uiState.value = mapOutcome(repository.restoreSession())
        }
    }

    fun signIn() {
        viewModelScope.launch {
            _uiState.value = AuthUiState.SigningIn
            when (val outcome = repository.signInWithGoogle()) {
                is OwnerAuthRepository.RestoreOutcome.Failed ->
                    _uiState.value = AuthUiState.SignedOut(errorMessage = outcome.message)
                OwnerAuthRepository.RestoreOutcome.ConfigMissing ->
                    _uiState.value =
                        AuthUiState.SignedOut(
                            errorMessage =
                            getApplication<Application>()
                                .getString(com.aicommunication.assistant.R.string.error_auth_config)
                        )
                else -> {
                    // Custom Tab is open; remain on sign-in until deep link or cancel.
                    _uiState.value = AuthUiState.SignedOut()
                }
            }
        }
    }

    fun onOAuthIntent(intent: Intent?) {
        if (intent?.data == null) {
            return
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState.Loading
            _uiState.value = mapOutcome(repository.completeOAuthFromIntent(intent))
        }
    }

    fun retryConnectivity() {
        restore()
    }

    fun signOut() {
        viewModelScope.launch {
            _uiState.value = AuthUiState.SigningOut
            repository.signOut()
            _uiState.value = AuthUiState.SignedOut()
        }
    }

    /**
     * Owner API returned Unauthorized after refresh — clear the local session and return to sign-in.
     */
    fun notifySessionInvalidated() {
        viewModelScope.launch {
            repository.signOut()
            _uiState.value =
                AuthUiState.SignedOut(
                    errorMessage =
                    getApplication<Application>()
                        .getString(com.aicommunication.assistant.R.string.error_session_unavailable)
                )
        }
    }

    private fun mapOutcome(outcome: OwnerAuthRepository.RestoreOutcome): AuthUiState {
        val app = getApplication<Application>()
        return when (outcome) {
            is OwnerAuthRepository.RestoreOutcome.Authenticated ->
                AuthUiState.Authenticated(outcome.session)
            OwnerAuthRepository.RestoreOutcome.SignedOut -> AuthUiState.SignedOut()
            OwnerAuthRepository.RestoreOutcome.ConfigMissing ->
                AuthUiState.SignedOut(
                    errorMessage = app.getString(
                        com.aicommunication.assistant.R.string.error_auth_config
                    )
                )
            OwnerAuthRepository.RestoreOutcome.UnauthorizedDomain ->
                AuthUiState.SignedOut(
                    errorMessage = app.getString(
                        com.aicommunication.assistant.R.string.error_unauthorized_domain
                    )
                )
            OwnerAuthRepository.RestoreOutcome.Connectivity ->
                AuthUiState.SignedOut(
                    errorMessage = app.getString(
                        com.aicommunication.assistant.R.string.error_connectivity
                    ),
                    connectivityIssue = true
                )
            is OwnerAuthRepository.RestoreOutcome.Failed ->
                AuthUiState.SignedOut(
                    errorMessage = outcome.message.ifBlank {
                        app.getString(com.aicommunication.assistant.R.string.error_auth_failed)
                    }
                )
        }
    }

    class Factory(
        private val application: Application,
        private val repository: OwnerAuthRepository
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(OwnerAuthViewModel::class.java)) {
                return OwnerAuthViewModel(application, repository) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
