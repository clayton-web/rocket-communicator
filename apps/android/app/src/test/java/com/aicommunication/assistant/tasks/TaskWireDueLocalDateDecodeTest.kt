package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.ownerApiMoshi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TaskWireDueLocalDateDecodeTest {
    private val taskAdapter = ownerApiMoshi().adapter(TaskWire::class.java)

    @Test
    fun decodesCanonicalDueLocalDateAndUrgency() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t1",
                  "etag": "\"task-t1-v1\"",
                  "status": "open",
                  "dueLocalDate": "2026-08-12",
                  "derivedUrgency": "overdue"
                }
                """.trimIndent()
            )
        requireNotNull(task)
        assertEquals("2026-08-12", task.dueLocalDate)
        assertEquals("overdue", task.derivedUrgency)
        assertEquals("2026-08-12", task.toOwnerTask().dueLocalDate)
        assertEquals("Overdue", task.toOwnerTask().urgencyLabel)
    }

    @Test
    fun ignoresVestigialDueAtWhenDueLocalDateIsAbsent() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t1",
                  "etag": "\"task-t1-v1\"",
                  "status": "open",
                  "dueAt": "2020-01-01T00:00:00.000Z",
                  "dueLocalDate": null,
                  "derivedUrgency": null
                }
                """.trimIndent()
            )
        requireNotNull(task)
        assertNull(task.dueLocalDate)
        assertNull(task.derivedUrgency)
        assertNull(task.toOwnerTask().dueLocalDate)
        assertNull(task.toOwnerTask().urgencyLabel)
    }

    @Test
    fun doesNotCopyDueAtOntoDueLocalDate() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t1",
                  "etag": "\"task-t1-v1\"",
                  "status": "open",
                  "dueAt": "2020-01-01T00:00:00.000Z",
                  "dueLocalDate": "2026-08-20",
                  "derivedUrgency": null
                }
                """.trimIndent()
            )
        requireNotNull(task)
        assertEquals("2026-08-20", task.dueLocalDate)
        assertNull(task.derivedUrgency)
    }
}
