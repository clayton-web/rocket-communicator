package com.aicommunication.assistant.network

import com.aicommunication.assistant.auth.AuthConfig
import java.net.URI
import java.net.URISyntaxException

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

    /**
     * Host only, for privacy-safe diagnostics that need to say which deployment answered.
     *
     * Deliberately drops scheme, userinfo, port, path, and query, so the label cannot carry a
     * credential, a capability token, or an environment secret. Port is excluded so the label is
     * stable across runs rather than useful for addressing a host.
     */
    val hostLabel: String
        get() =
            try {
                URI(normalizedApiBaseUrl).host?.takeIf { it.isNotBlank() } ?: UNKNOWN_HOST
            } catch (_: URISyntaxException) {
                UNKNOWN_HOST
            }

    companion object {
        const val UNKNOWN_HOST = "unknown-host"

        fun fromAuthConfig(authConfig: AuthConfig): ApiConfig =
            ApiConfig(apiBaseUrl = authConfig.normalizedApiBaseUrl)
    }
}
