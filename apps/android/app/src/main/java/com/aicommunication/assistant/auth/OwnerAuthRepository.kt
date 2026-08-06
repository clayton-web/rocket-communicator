package com.aicommunication.assistant.auth

import android.content.Intent
import com.aicommunication.assistant.contracts.models.Session
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.handleDeeplinks
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.status.SessionStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Android Owner authentication repository (A9.0 / D146).
 *
 * Presentation stays in Compose. Identity and authorization remain on the server.
 * Refresh is intentionally simple: restore on launch and refresh only when required
 * at startup or when authentication fails naturally — no background scheduler.
 */
class OwnerAuthRepository(
    private val config: AuthConfig,
    private val supabase: SupabaseClient?,
    private val sessionClient: OwnerSessionClient?
) {
    sealed class RestoreOutcome {
        data class Authenticated(val session: Session) : RestoreOutcome()

        data object SignedOut : RestoreOutcome()

        data object ConfigMissing : RestoreOutcome()

        data object UnauthorizedDomain : RestoreOutcome()

        data object Connectivity : RestoreOutcome()

        data class Failed(val message: String) : RestoreOutcome()
    }

    suspend fun restoreSession(): RestoreOutcome {
        val client = supabase ?: return RestoreOutcome.ConfigMissing
        val probe = sessionClient ?: return RestoreOutcome.ConfigMissing

        val status =
            withTimeoutOrNull(15_000) {
                client.auth.sessionStatus.first { candidate ->
                    candidate !is SessionStatus.Initializing
                }
            }

        return when (status) {
            is SessionStatus.Authenticated -> probeAccess(client, probe)
            is SessionStatus.NotAuthenticated -> RestoreOutcome.SignedOut
            is SessionStatus.RefreshFailure -> {
                // Natural auth failure at startup: one explicit refresh, then probe or clear.
                try {
                    client.auth.refreshCurrentSession()
                    probeAccess(client, probe)
                } catch (_: Exception) {
                    clearLocalSession(client)
                    RestoreOutcome.Connectivity
                }
            }
            null -> {
                val access = client.auth.currentAccessTokenOrNull()
                if (access.isNullOrBlank()) {
                    RestoreOutcome.Connectivity
                } else {
                    probeAccess(client, probe)
                }
            }
            else -> RestoreOutcome.SignedOut
        }
    }

    suspend fun signInWithGoogle(): RestoreOutcome {
        val client = supabase ?: return RestoreOutcome.ConfigMissing
        return try {
            client.auth.signInWith(Google) {
                if (config.ownerWorkspaceDomain.isNotBlank()) {
                    queryParams["hd"] = config.ownerWorkspaceDomain
                }
            }
            // Custom Tab continues asynchronously; deep-link completion drives the next probe.
            RestoreOutcome.SignedOut
        } catch (error: Exception) {
            RestoreOutcome.Failed(error.message ?: "Sign-in failed.")
        }
    }

    suspend fun completeOAuthFromIntent(intent: Intent): RestoreOutcome {
        val client = supabase ?: return RestoreOutcome.ConfigMissing
        val probe = sessionClient ?: return RestoreOutcome.ConfigMissing
        val data = intent.data ?: return RestoreOutcome.SignedOut
        if (data.scheme != AuthConfig.OAUTH_SCHEME || data.host != AuthConfig.OAUTH_HOST) {
            return RestoreOutcome.SignedOut
        }
        return try {
            client.handleDeeplinks(intent)
            val access = client.auth.currentAccessTokenOrNull()
            if (access.isNullOrBlank()) {
                RestoreOutcome.Failed("Sign-in was interrupted. Please try again.")
            } else {
                probeAccess(client, probe)
            }
        } catch (error: Exception) {
            RestoreOutcome.Failed(error.message ?: "Sign-in failed.")
        }
    }

    /**
     * End the Android Owner session only (D147).
     *
     * Uses [SignOutScope.LOCAL]: revokes this device's Supabase session and clears secure
     * storage. Does **not** terminate web or other-device sessions — GLOBAL would sign the
     * Owner out of the admin/fallback web surface whenever they leave the phone.
     */
    suspend fun signOut() {
        val client = supabase ?: return
        try {
            client.auth.signOut(SignOutScope.LOCAL)
        } catch (_: Exception) {
            clearLocalSession(client)
        }
    }

    private suspend fun clearLocalSession(client: SupabaseClient) {
        try {
            client.auth.clearSession()
        } catch (_: Exception) {
            try {
                client.auth.signOut(SignOutScope.LOCAL)
            } catch (_: Exception) {
                // Best effort.
            }
        }
    }

    private suspend fun probeAccess(
        client: SupabaseClient,
        probe: OwnerSessionClient
    ): RestoreOutcome {
        var access = client.auth.currentAccessTokenOrNull()
        if (access.isNullOrBlank()) {
            return RestoreOutcome.SignedOut
        }

        return when (val first = probe.fetchSession(access)) {
            is OwnerSessionClient.ProbeResult.Success -> RestoreOutcome.Authenticated(first.session)
            OwnerSessionClient.ProbeResult.Unauthorized -> {
                try {
                    client.auth.refreshCurrentSession()
                    access = client.auth.currentAccessTokenOrNull()
                    if (access.isNullOrBlank()) {
                        clearLocalSession(client)
                        return RestoreOutcome.UnauthorizedDomain
                    }
                    when (val second = probe.fetchSession(access)) {
                        is OwnerSessionClient.ProbeResult.Success ->
                            RestoreOutcome.Authenticated(second.session)
                        OwnerSessionClient.ProbeResult.Unauthorized -> {
                            clearLocalSession(client)
                            RestoreOutcome.UnauthorizedDomain
                        }
                        OwnerSessionClient.ProbeResult.Connectivity -> RestoreOutcome.Connectivity
                        is OwnerSessionClient.ProbeResult.Unexpected -> {
                            clearLocalSession(client)
                            RestoreOutcome.Failed(second.message)
                        }
                    }
                } catch (_: Exception) {
                    clearLocalSession(client)
                    RestoreOutcome.UnauthorizedDomain
                }
            }
            OwnerSessionClient.ProbeResult.Connectivity -> RestoreOutcome.Connectivity
            is OwnerSessionClient.ProbeResult.Unexpected -> RestoreOutcome.Failed(first.message)
        }
    }
}
