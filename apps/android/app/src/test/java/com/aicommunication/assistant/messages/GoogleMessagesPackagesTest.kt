package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleMessagesPackagesTest {
    @Test
    fun allowlist_isExactlyPublishedGoogleMessages() {
        assertEquals("com.google.android.apps.messaging", GoogleMessagesPackages.GOOGLE_MESSAGES)
        assertEquals(
            setOf(GoogleMessagesPackages.GOOGLE_MESSAGES),
            GoogleMessagesPackages.ALLOWLIST
        )
        assertTrue(GoogleMessagesPackages.isAllowed(GoogleMessagesPackages.GOOGLE_MESSAGES))
    }

    @Test
    fun allowlist_rejectsOtherPackagesIncludingSamsungMessages() {
        assertFalse(GoogleMessagesPackages.isAllowed("com.samsung.android.messaging"))
        assertFalse(GoogleMessagesPackages.isAllowed("com.android.mms"))
        assertFalse(GoogleMessagesPackages.isAllowed("com.google.android.gm"))
        assertFalse(GoogleMessagesPackages.isAllowed(""))
    }
}
