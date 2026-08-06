package com.aicommunication.assistant.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthConfigTest {
    @Test
    fun isConfigured_requiresSupabaseAndApiBase() {
        assertFalse(
            AuthConfig(
                apiBaseUrl = "",
                supabaseUrl = "https://example.supabase.co",
                supabaseAnonKey = "anon",
                ownerWorkspaceDomain = "example.com"
            ).isConfigured
        )
        assertTrue(
            AuthConfig(
                apiBaseUrl = "http://10.0.2.2:3000/",
                supabaseUrl = "https://example.supabase.co",
                supabaseAnonKey = "anon",
                ownerWorkspaceDomain = "example.com"
            ).isConfigured
        )
    }

    @Test
    fun normalizedApiBaseUrl_trimsTrailingSlash() {
        val config =
            AuthConfig(
                apiBaseUrl = "https://app.example.com/",
                supabaseUrl = "https://example.supabase.co",
                supabaseAnonKey = "anon",
                ownerWorkspaceDomain = ""
            )
        assertEquals("https://app.example.com", config.normalizedApiBaseUrl)
    }
}
