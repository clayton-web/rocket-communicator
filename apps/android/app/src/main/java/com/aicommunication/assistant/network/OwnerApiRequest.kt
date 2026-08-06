package com.aicommunication.assistant.network

/**
 * Central request description for Owner APIs (A9.1). Path is relative to [ApiConfig] base
 * (e.g. `/api/v1/session`). No Task-specific fields.
 */
data class OwnerApiRequest(
    val method: Method,
    val path: String,
    val headers: Map<String, String> = emptyMap(),
    val jsonBody: String? = null,
    val requiresAuthentication: Boolean = true
) {
    enum class Method {
        GET,
        POST,
        PUT,
        PATCH,
        DELETE
    }
}
