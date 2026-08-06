package com.aicommunication.assistant.network

import com.aicommunication.assistant.auth.AuthConfig

/**
 * Reusable Owner API host configuration (A9.1).
 *
 * Sourced from the same BuildConfig / local.properties values as A9.0 auth — one API base
 * for session probe and all future Owner routes.
 */
data class ApiConfig(
    val apiBaseUrl: String
) {
    val normalizedApiBaseUrl: String
        get() = apiBaseUrl.trim().trimEnd('/')

    val isConfigured: Boolean
        get() = normalizedApiBaseUrl.isNotBlank()

    fun url(path: String): String {
        val normalizedPath = if (path.startsWith("/")) path else "/$path"
        return normalizedApiBaseUrl + normalizedPath
    }

    companion object {
        fun fromAuthConfig(authConfig: AuthConfig): ApiConfig =
            ApiConfig(apiBaseUrl = authConfig.normalizedApiBaseUrl)
    }
}
