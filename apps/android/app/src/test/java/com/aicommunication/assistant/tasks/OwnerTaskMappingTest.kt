package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.capture.CaptureSummaryPointWire
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnerTaskMappingTest {
    @Test
    fun unassignedTask_isOwnerWorkAndAssignable() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "open",
                summaryPoints =
                listOf(
                    CaptureSummaryPointWire(
                        id = "p1",
                        kind = "confirmed_fact",
                        label = "Captured",
                        order = 0,
                        value = "Order lumber"
                    )
                )
            ).toOwnerTask()

        assertTrue(task.isOwnerWork)
        assertTrue(task.canAssign)
        assertEquals("Owner work (unassigned)", task.ownershipLabel)
        assertEquals("Order lumber", task.displayTitle)
    }

    @Test
    fun assignedTask_cannotAssignAgain() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "open",
                assignment =
                AssignmentWire(
                    intendedRecipientEmail = "a@example.com",
                    deliveryStatus = "sent"
                )
            ).toOwnerTask()

        assertFalse(task.isOwnerWork)
        assertFalse(task.canAssign)
        assertTrue(task.ownershipLabel.contains("a@example.com"))
    }
}
