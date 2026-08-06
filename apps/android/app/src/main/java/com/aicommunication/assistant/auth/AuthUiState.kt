package com.aicommunication.assistant.auth

import com.aicommunication.assistant.contracts.models.Session

sealed class AuthUiState {
    data object Loading : AuthUiState()

    data object SigningIn : AuthUiState()

    data object SigningOut : AuthUiState()

    data class SignedOut(
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false
    ) : AuthUiState()

    data class Authenticated(
        val session: Session
    ) : AuthUiState()
}
