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
        assertEquals(null, task.dueLocalDate)
        assertEquals(null, task.derivedUrgency)
        assertEquals(null, task.urgencyLabel)
    }

    @Test
    fun failedAssignment_canReturnToOwnerAndCannotAssign() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "in_progress",
                assignment =
                AssignmentWire(
                    intendedRecipientEmail = "a@example.com",
                    deliveryStatus = "failed"
                )
            ).toOwnerTask()

        assertTrue(task.canReturnFailedAssignmentToOwner)
        assertFalse(task.canAssign)
        assertTrue(task.ownershipLabel.contains("failed"))
        assertFalse(task.ownershipLabel.contains("sent"))
    }

    @Test
    fun healthyAssignment_cannotReturnToOwner() {
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

        assertFalse(task.canReturnFailedAssignmentToOwner)
        assertFalse(task.canAssign)
    }

    @Test
    fun terminalFailedAssignment_cannotReturnToOwner() {
        val completed =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "completed",
                assignment =
                AssignmentWire(
                    intendedRecipientEmail = "a@example.com",
                    deliveryStatus = "failed"
                )
            ).toOwnerTask()
        val dismissed = completed.copy(status = "dismissed")

        assertFalse(completed.canReturnFailedAssignmentToOwner)
        assertFalse(dismissed.canReturnFailedAssignmentToOwner)
    }

    @Test
    fun unassignedTask_cannotReturnToOwner() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "open"
            ).toOwnerTask()

        assertFalse(task.canReturnFailedAssignmentToOwner)
        assertTrue(task.canAssign)
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

    @Test
    fun dueLocalDateAndUrgency_mapWithoutUsingDueAtOrAssignment() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "open",
                dueLocalDate = "2026-08-12",
                derivedUrgency = "overdue"
            ).toOwnerTask()

        assertEquals("2026-08-12", task.dueLocalDate)
        assertEquals("overdue", task.derivedUrgency)
        assertEquals("Overdue", task.urgencyLabel)
        assertTrue(task.isOwnerWork)
    }

    @Test
    fun dueSoonLabel_isIndependentOfAssignment() {
        val task =
            TaskWire(
                id = "t1",
                etag = "e1",
                status = "open",
                dueLocalDate = "2026-08-13",
                derivedUrgency = "due_soon"
            ).toOwnerTask()

        assertEquals("Due soon", task.urgencyLabel)
        assertTrue(task.isOwnerWork)
    }
}
