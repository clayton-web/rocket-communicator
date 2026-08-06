package com.aicommunication.assistant.capture

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskTitleTest {
    @Test
    fun deriveCapturedTaskTitle_usesFirstSummaryValue() {
        val title =
            deriveCapturedTaskTitle(
                taskId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                summaryPoints =
                listOf(
                    CaptureSummaryPointWire(
                        id = "p1",
                        kind = "confirmed_fact",
                        label = "Captured",
                        order = 0,
                        value = "Call the contractor"
                    )
                )
            )
        assertEquals("Call the contractor", title)
    }

    @Test
    fun deriveCapturedTaskTitle_fallsBackToShortId() {
        val title =
            deriveCapturedTaskTitle(
                taskId = "abcdef12-3456-7890-abcd-ef1234567890",
                summaryPoints = emptyList()
            )
        assertEquals("Task abcdef12", title)
    }

    @Test
    fun deriveCapturedTaskTitle_truncatesLongText() {
        val long = "x".repeat(150)
        val title =
            deriveCapturedTaskTitle(
                taskId = "id",
                summaryPoints =
                listOf(
                    CaptureSummaryPointWire(
                        id = "p1",
                        kind = "confirmed_fact",
                        label = "Captured",
                        order = 0,
                        value = long
                    )
                )
            )
        assertEquals(120, title.length)
    }
}
