package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskDetailUiState
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class, qualifiers = "w411dp-h891dp")
class TaskDetailScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun ready_showsLifecycleAndAssignForUnassigned() {
        setReady(task())

        composeRule.onNodeWithTag("task_detail_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_title").assertIsDisplayed()
        composeRule.onNodeWithText("Call painter").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_ownership").assertIsDisplayed()
        composeRule.onNodeWithText("Start").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Complete").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Assign").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun ready_showsExistingDeadlineAndOverdueFromTaskRead() {
        setReady(
            task(dueLocalDate = "2026-08-12", derivedUrgency = "overdue"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = true,
            advanceDisposition = "scheduled",
            advanceOccurrenceLocalDate = "2026-08-11"
        )

        composeRule.onNodeWithTag("task_detail_scheduling_section").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_due_section").assertIsDisplayed()
        composeRule.onAllNodesWithTag("task_detail_due_section").assertCountEquals(1)
        composeRule.onNodeWithTag("task_detail_due_date").assertIsDisplayed()
        composeRule.onNodeWithText("Wednesday, August 12").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_urgency").assertIsDisplayed()
        composeRule.onNodeWithText("Overdue").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_due_empty").assertDoesNotExist()
    }

    @Test
    fun ready_showsDueSoonWithoutAssignmentOrEvidence() {
        setReady(
            task(dueLocalDate = "2026-08-13", derivedUrgency = "due_soon"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = true,
            advanceDisposition = "scheduled",
            advanceOccurrenceLocalDate = "2026-08-12"
        )

        composeRule.onNodeWithText("Due soon").assertIsDisplayed()
        composeRule.onNodeWithText("Owner work (unassigned)").assertIsDisplayed()
    }

    @Test
    fun ready_showsNoDeadlineAndDisabledAutomaticReminder() {
        setReady(task(), reminderEtag = "\"task-reminder-t1-v0\"")

        composeRule.onNodeWithTag("task_detail_due_empty").assertIsDisplayed()
        composeRule.onNodeWithText("No deadline").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_set_due_date").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_clear_due_date").assertDoesNotExist()
        composeRule.onNodeWithTag("task_detail_urgency").assertDoesNotExist()
        composeRule.onNodeWithTag("task_detail_advance_unavailable").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_advance_occurrence").assertDoesNotExist()
        composeRule.onNodeWithTag("task_detail_advance_toggle", useUnmergedTree = true)
            .assertIsNotEnabled()
    }

    @Test
    fun ready_onShowsDayBeforeDateAndNineAmWithoutClaimingDelivery() {
        setReady(
            task(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = true,
            advanceDisposition = "scheduled",
            advanceOccurrenceLocalDate = "2026-08-20"
        )

        composeRule.onNodeWithTag("task_detail_advance_occurrence").performScrollTo()
            .assertIsDisplayed()
        composeRule.onNodeWithText("Thursday, August 20 · 9:00 AM").assertIsDisplayed()
        composeRule.onNodeWithText("Day before the deadline").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_advance_off").assertDoesNotExist()
        composeRule.onNodeWithText("will be sent", substring = true, ignoreCase = true)
            .assertDoesNotExist()
        composeRule.onNodeWithText("Notification scheduled", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Recipient will receive", substring = true).assertDoesNotExist()
    }

    @Test
    fun ready_offRetainsDeadlineAndDoesNotClaimActiveOccurrence() {
        setReady(
            task(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = false,
            advanceDisposition = "not_enabled",
            advanceOccurrenceLocalDate = "2026-08-20"
        )

        composeRule.onNodeWithText("Friday, August 21").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_advance_off").assertIsDisplayed()
        composeRule.onNodeWithText("Deadline is kept. Overdue follow-through is unchanged.")
            .assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_advance_occurrence").assertDoesNotExist()
        composeRule.onNodeWithText("9:00 AM").assertDoesNotExist()
        composeRule.onAllNodesWithTag("task_detail_reminders_group").assertCountEquals(1)
    }

    @Test
    fun ready_hasNoTimePickerAddReminderOrMultipleReminderRows() {
        setReady(
            task(dueLocalDate = "2026-08-20", derivedUrgency = "due_soon"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = true,
            advanceDisposition = "scheduled",
            advanceOccurrenceLocalDate = "2026-08-19"
        )

        composeRule.onAllNodesWithTag("task_detail_due_section").assertCountEquals(1)
        composeRule.onAllNodesWithTag("task_detail_advance_section").assertCountEquals(1)
        composeRule.onNodeWithTag("task_detail_time_picker").assertDoesNotExist()
        composeRule.onNodeWithTag("task_detail_reminder_time").assertDoesNotExist()
        composeRule.onNodeWithText("Add reminder", substring = true, ignoreCase = true)
            .assertDoesNotExist()
        composeRule.onNodeWithText("Reminder time", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Notify", substring = true).assertDoesNotExist()

        composeRule.onNodeWithTag("task_detail_set_due_date").performClick()
        composeRule.onNodeWithTag("task_detail_date_picker").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_time_picker").assertDoesNotExist()
    }

    @Test
    fun ready_failedDeliveryExposesReturnToOwnerWithoutSuccessSemantics() {
        setReady(
            task(
                assignmentEmail = "alex@example.com",
                deliveryStatus = "failed",
                status = "in_progress"
            )
        )

        composeRule.onNodeWithText("Assigned to alex@example.com (failed)").assertIsDisplayed()
        composeRule.onNodeWithTag("task_return_to_owner_explanation").performScrollTo()
            .assertIsDisplayed()
        composeRule.onNodeWithTag("task_action_return_to_owner").performScrollTo()
            .assertIsDisplayed()
        composeRule.onNodeWithTag("task_action_assign").assertDoesNotExist()
        composeRule.onNodeWithText("Assignment sent", substring = true).assertDoesNotExist()
    }

    @Test
    fun ready_unassignedTaskDoesNotShowFailedAssignmentRecovery() {
        setReady(task())

        composeRule.onNodeWithText("Owner work (unassigned)").assertIsDisplayed()
        composeRule.onNodeWithTag("task_action_return_to_owner").assertDoesNotExist()
        composeRule.onNodeWithTag("task_return_to_owner_explanation").assertDoesNotExist()
        composeRule.onNodeWithText("Assign").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun ready_toggleClickReportsAdvanceEnabledChange() {
        var reported: Boolean? = null
        setReady(
            task(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon"),
            reminderEtag = "\"task-reminder-t1-v1\"",
            advanceEnabled = true,
            advanceDisposition = "scheduled",
            advanceOccurrenceLocalDate = "2026-08-20",
            onSetAdvanceEnabled = { reported = it }
        )

        composeRule.onNodeWithTag("task_detail_advance_toggle").performScrollTo().performClick()
        assertEquals(false, reported)
    }

    private fun task(
        dueLocalDate: String? = null,
        derivedUrgency: String? = null,
        assignmentEmail: String? = null,
        deliveryStatus: String? = null,
        status: String = "open"
    ) = OwnerTask(
        id = "t1",
        etag = "\"task-t1-v1\"",
        status = status,
        displayTitle = "Call painter",
        assignmentEmail = assignmentEmail,
        deliveryStatus = deliveryStatus,
        noteBodies = emptyList(),
        updatedAt = null,
        dueLocalDate = dueLocalDate,
        derivedUrgency = derivedUrgency
    )

    private fun setReady(
        task: OwnerTask,
        reminderEtag: String? = null,
        advanceEnabled: Boolean? = null,
        advanceDisposition: String? = null,
        advanceOccurrenceLocalDate: String? = null,
        onSetAdvanceEnabled: (Boolean) -> Unit = {}
    ) {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskDetailScreen(
                    state =
                    TaskDetailUiState.Ready(
                        task = task,
                        reminderEtag = reminderEtag,
                        advanceEnabled = advanceEnabled,
                        advanceDisposition = advanceDisposition,
                        advanceOccurrenceLocalDate = advanceOccurrenceLocalDate
                    ),
                    onBack = {},
                    onRetry = {},
                    onStart = {},
                    onWaiting = {},
                    onResume = {},
                    onComplete = {},
                    onDismiss = {},
                    onAssign = {},
                    onReturnToOwner = {},
                    onSetDueDate = {},
                    onClearDueDate = {},
                    onSetAdvanceEnabled = onSetAdvanceEnabled,
                    onNoteChanged = {},
                    onSaveNote = {}
                )
            }
        }
    }
}
