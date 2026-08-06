package com.aicommunication.assistant.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeHttpLoggerTest {
    @Test
    fun redactUrl_hidesCapabilityTokenPath() {
        assertEquals(
            "/api/v1/capabilities/<redacted>",
            SafeHttpLogger.redactUrl("/api/v1/capabilities/super-secret-token/tasks/1")
        )
    }

    @Test
    fun redactUrl_keepsOrdinaryOwnerPaths() {
        assertEquals(
            "/api/v1/session",
            SafeHttpLogger.redactUrl("/api/v1/session")
        )
    }

    @Test
    fun containsCredentialLeak_detectsBearerMaterial() {
        assertTrue(SafeHttpLogger.containsCredentialLeak("Authorization: Bearer abc"))
        assertTrue(SafeHttpLogger.containsCredentialLeak("""{"access_token":"x"}"""))
        assertFalse(SafeHttpLogger.containsCredentialLeak("GET /api/v1/session"))
    }
}
