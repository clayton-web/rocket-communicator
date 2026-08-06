package com.aicommunication.assistant.network

import android.util.Log
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Development-safe HTTP logging (A9.1).
 *
 * Logs method, redacted URL path, and status only. Never logs Authorization, Cookie,
 * tokens, or response/request bodies.
 */
class SafeHttpLogger(
    private val enabled: Boolean,
    private val tag: String = "OwnerHttp"
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (enabled) {
            Log.d(tag, "${request.method} ${redactUrl(request.url.encodedPath)}")
        }
        val response = chain.proceed(request)
        if (enabled) {
            Log.d(tag, "${response.code} ${request.method} ${redactUrl(request.url.encodedPath)}")
        }
        return response
    }

    companion object {
        fun redactUrl(path: String): String {
            // Capability tokens live in path segments under /capabilities/ — never log raw paths
            // that might include secrets. Collapse anything after /capabilities/.
            val marker = "/api/v1/capabilities/"
            val index = path.indexOf(marker)
            if (index >= 0) {
                return path.substring(0, index + marker.length) + "<redacted>"
            }
            return path
        }

        fun containsCredentialLeak(text: String): Boolean {
            val lower = text.lowercase()
            return lower.contains("authorization") ||
                lower.contains("bearer ") ||
                lower.contains("refresh_token") ||
                lower.contains("access_token")
        }
    }
}
