package com.aicommunication.assistant.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth

/**
 * Supplies Supabase access JWTs for Owner API Bearer auth (A9.1 / D145).
 *
 * Does not perform identity or allowlist checks — the server remains authoritative.
 */
interface AccessTokenProvider {
    suspend fun currentAccessToken(): String?

    /**
     * Refresh only when required (startup / natural auth failure). No background scheduling.
     */
    suspend fun refreshAccessToken(): String?
}

class SupabaseAccessTokenProvider(
    private val supabase: SupabaseClient?
) : AccessTokenProvider {
    override suspend fun currentAccessToken(): String? = supabase?.auth?.currentAccessTokenOrNull()

    override suspend fun refreshAccessToken(): String? {
        val client = supabase ?: return null
        return try {
            client.auth.refreshCurrentSession()
            client.auth.currentAccessTokenOrNull()
        } catch (_: Exception) {
            null
        }
    }
}
