package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.ownerApiMoshi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TaskReminderWireDecodeTest {
    private val adapter = ownerApiMoshi().adapter(TaskReminderWire::class.java)

    @Test
    fun decodesAdvancePreferenceAndOccurrence() {
        val reminder =
            adapter.fromJson(
                """
                {
                  "taskId": "t1",
                  "etag": "\"task-reminder-t1-v1\"",
                  "state": "active",
                  "dueLocalDate": "2026-08-21",
                  "advanceEnabled": true,
                  "advance": {
                    "disposition": "scheduled",
                    "occurrence": {
                      "localDate": "2026-08-20",
                      "at": "2026-08-20T16:00:00.000Z"
                    }
                  }
                }
                """.trimIndent()
            )
        requireNotNull(reminder)
        assertEquals("t1", reminder.taskId)
        assertEquals("\"task-reminder-t1-v1\"", reminder.etag)
        assertEquals("2026-08-21", reminder.dueLocalDate)
        assertEquals(true, reminder.advanceEnabled)
        assertEquals("scheduled", reminder.advance?.disposition)
        assertEquals("2026-08-20", reminder.advance?.occurrence?.localDate)
    }

    @Test
    fun decodesOffPreferenceWithoutTreatingOccurrenceAsEnabled() {
        val reminder =
            adapter.fromJson(
                """
                {
                  "taskId": "t1",
                  "etag": "\"task-reminder-t1-v2\"",
                  "state": "active",
                  "dueLocalDate": "2026-08-21",
                  "advanceEnabled": false,
                  "advance": {
                    "disposition": "not_enabled",
                    "occurrence": {
                      "localDate": "2026-08-20",
                      "at": "2026-08-20T16:00:00.000Z"
                    }
                  }
                }
                """.trimIndent()
            )
        requireNotNull(reminder)
        assertEquals(false, reminder.advanceEnabled)
        assertEquals("not_enabled", reminder.advance?.disposition)
        assertEquals("2026-08-21", reminder.dueLocalDate)
    }

    @Test
    fun decodesNoDeadlineAsNullPreference() {
        val reminder =
            adapter.fromJson(
                """
                {
                  "taskId": "t1",
                  "etag": "\"task-reminder-t1-v0\"",
                  "state": "no_due_date",
                  "dueLocalDate": null,
                  "advanceEnabled": null
                }
                """.trimIndent()
            )
        requireNotNull(reminder)
        assertNull(reminder.dueLocalDate)
        assertNull(reminder.advanceEnabled)
        assertNull(reminder.advance)
    }
}
