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
}
