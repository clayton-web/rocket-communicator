package com.aicommunication.assistant.auth

import com.aicommunication.assistant.BuildConfig

/**
 * Runtime auth configuration for A9.0 (D146).
 *
 * Supabase establishes identity. [apiBaseUrl] is the Next.js Owner API host used for
 * `GET /api/v1/session`. Values come from BuildConfig / local.properties — never hard-code
 * production secrets in source.
 */
data class AuthConfig(
    val apiBaseUrl: String,
    val supabaseUrl: String,
    val supabaseAnonKey: String,
    val ownerWorkspaceDomain: String
) {
    val isConfigured: Boolean
        get() = supabaseUrl.isNotBlank() && supabaseAnonKey.isNotBlank() && apiBaseUrl.isNotBlank()

    val normalizedApiBaseUrl: String
        get() = apiBaseUrl.trim().trimEnd('/')

    companion object {
        const val OAUTH_SCHEME = "aicaa"
        const val OAUTH_HOST = "auth-callback"

        fun fromBuildConfig(): AuthConfig = AuthConfig(
            apiBaseUrl = BuildConfig.API_BASE_URL.trim(),
            supabaseUrl = BuildConfig.SUPABASE_URL.trim(),
            supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY.trim(),
            ownerWorkspaceDomain = BuildConfig.OWNER_WORKSPACE_DOMAIN.trim()
        )
    }
}
