package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesNotificationShapeProbeTest {
    @Test
    fun disabledProbe_recordsNothing() {
        val probe = MessagesNotificationShapeProbe(enabled = false)
        probe.record(MessagesNotificationShape.from(observation()))
        assertTrue(probe.recent().isEmpty())
    }

    @Test
    fun enabledProbe_recordsPresenceNotContent() {
        val probe = MessagesNotificationShapeProbe(enabled = true, maxShapes = 2)
        val first =
            observation(
                title = "SECRET-NUMBER",
                text = "secret body",
                extraKeys = setOf("android.title", "android.text")
            )
        val second = observation(notificationKey = "k2", extraKeys = setOf("android.title"))
        probe.record(MessagesNotificationShape.from(first))
        probe.record(MessagesNotificationShape.from(second))
        probe.record(MessagesNotificationShape.from(observation(notificationKey = "k3")))

        val recent = probe.recent()
        assertEquals(2, recent.size)
        val line = recent.first().toString()
        assertFalse(line.contains("SECRET-NUMBER"))
        assertFalse(line.contains("secret body"))
        assertTrue(recent.first().hasTitle)
        assertTrue(recent[1].extraKeys.contains("android.title"))
    }
}
