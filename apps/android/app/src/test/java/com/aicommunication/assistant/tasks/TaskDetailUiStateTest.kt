package com.aicommunication.assistant.tasks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskDetailUiStateTest {
    @Test
    fun noDeadline_doesNotShowAutomaticOccurrence() {
        val ready = ready(dueLocalDate = null, advanceEnabled = null)
        assertFalse(ready.hasDeadline)
        assertFalse(ready.automaticReminderOn)
        assertFalse(ready.showsAutomaticAdvanceOccurrence)
        assertNull(ready.automaticAdvanceLocalDate)
        assertFalse(ready.canEditAdvanceReminder)
    }

    @Test
    fun onScheduled_usesServerOccurrenceDate() {
        val ready =
            ready(
                dueLocalDate = "2026-08-21",
                advanceEnabled = true,
                advanceDisposition = "scheduled",
                advanceOccurrenceLocalDate = "2026-08-20"
            )
        assertTrue(ready.hasDeadline)
        assertTrue(ready.automaticReminderOn)
        assertTrue(ready.showsAutomaticAdvanceOccurrence)
        assertEquals("2026-08-20", ready.automaticAdvanceLocalDate)
        assertTrue(ready.canEditAdvanceReminder)
    }

    @Test
    fun off_retainsDeadlineWithoutActiveOccurrence() {
        val ready =
            ready(
                dueLocalDate = "2026-08-21",
                advanceEnabled = false,
                advanceDisposition = "not_enabled",
                advanceOccurrenceLocalDate = "2026-08-20"
            )
        assertTrue(ready.hasDeadline)
        assertFalse(ready.automaticReminderOn)
        assertFalse(ready.showsAutomaticAdvanceOccurrence)
        assertNull(ready.automaticAdvanceLocalDate)
    }

    @Test
    fun onWithoutOccurrence_fallsBackToDayBeforeDeadline() {
        val ready =
            ready(
                dueLocalDate = "2026-08-21",
                advanceEnabled = true,
                advanceDisposition = "scheduled",
                advanceOccurrenceLocalDate = null
            )
        assertEquals("2026-08-20", ready.automaticAdvanceLocalDate)
    }

    private fun ready(
        dueLocalDate: String?,
        advanceEnabled: Boolean?,
        advanceDisposition: String? = null,
        advanceOccurrenceLocalDate: String? = null
    ) = TaskDetailUiState.Ready(
        task =
        OwnerTask(
            id = "t1",
            etag = "\"task-t1-v1\"",
            status = "open",
            displayTitle = "Call painter",
            assignmentEmail = null,
            deliveryStatus = null,
            noteBodies = emptyList(),
            updatedAt = null,
            dueLocalDate = dueLocalDate
        ),
        reminderEtag = "\"task-reminder-t1-v1\"",
        advanceEnabled = advanceEnabled,
        advanceDisposition = advanceDisposition,
        advanceOccurrenceLocalDate = advanceOccurrenceLocalDate
    )
}
