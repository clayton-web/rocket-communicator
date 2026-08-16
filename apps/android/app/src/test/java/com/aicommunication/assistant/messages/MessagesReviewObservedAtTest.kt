package com.aicommunication.assistant.messages

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesReviewObservedAtTest {
    @Test
    fun fromPostedAtMs_usesTheOriginalNotificationInstantNotNow() {
        val postedAtMs = 1_700_000_000_000L
        val observedAt = MessagesReviewObservedAt.fromPostedAtMs(postedAtMs)

        assertEquals("2023-11-14T22:13:20Z", observedAt)
        assertEquals(Instant.ofEpochMilli(postedAtMs).toString(), observedAt)
        assertTrue(observedAt.endsWith("Z"))
        assertTrue(Instant.now().toEpochMilli() > postedAtMs)
        assertTrue(observedAt != Instant.now().toString())
    }

    @Test
    fun fromPostedAtMs_isStableAcrossRetries() {
        val postedAtMs = 1_699_123_456_789L
        val first = MessagesReviewObservedAt.fromPostedAtMs(postedAtMs)
        Thread.sleep(5)
        val retry = MessagesReviewObservedAt.fromPostedAtMs(postedAtMs)

        assertEquals(first, retry)
        assertEquals(Instant.ofEpochMilli(postedAtMs).toString(), retry)
    }
}
