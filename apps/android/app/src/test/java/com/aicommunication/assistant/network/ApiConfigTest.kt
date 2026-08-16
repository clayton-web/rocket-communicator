package com.aicommunication.assistant.network

import com.aicommunication.assistant.auth.AuthConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiConfigTest {
    @Test
    fun fromAuthConfig_normalizesBaseAndBuildsUrls() {
        val api =
            ApiConfig.fromAuthConfig(
                AuthConfig(
                    apiBaseUrl = "https://app.example.com/",
                    supabaseUrl = "https://example.supabase.co",
                    supabaseAnonKey = "anon",
                    ownerWorkspaceDomain = "example.com"
                )
            )

        assertTrue(api.isConfigured)
        assertEquals("https://app.example.com", api.normalizedApiBaseUrl)
        assertEquals("https://app.example.com/api/v1/session", api.url("/api/v1/session"))
        assertEquals("https://app.example.com/api/v1/session", api.url("api/v1/session"))
    }

    @Test
    fun hostLabelIsTheHostAloneSoDiagnosticsCanNameADeploymentSafely() {
        assertEquals("app.example.com", ApiConfig("https://app.example.com").hostLabel)
        // Port, path, and query never reach the label.
        assertEquals("app.example.com", ApiConfig("https://app.example.com:8443/api/").hostLabel)
        assertEquals("app.example.com", ApiConfig("https://app.example.com/x?token=abc").hostLabel)
        assertEquals("localhost", ApiConfig("http://localhost:52341/").hostLabel)
    }

    @Test
    fun hostLabelNeverCarriesCredentialsOrCollapsesToAnEmptyValue() {
        // A base URL with userinfo must not leak it into a log line.
        val withUserInfo = ApiConfig("https://owner:secret@app.example.com").hostLabel
        assertEquals("app.example.com", withUserInfo)

        assertEquals(ApiConfig.UNKNOWN_HOST, ApiConfig("").hostLabel)
        assertEquals(ApiConfig.UNKNOWN_HOST, ApiConfig("not a url").hostLabel)
    }
}
