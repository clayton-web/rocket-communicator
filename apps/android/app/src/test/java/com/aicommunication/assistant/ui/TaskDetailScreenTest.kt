package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskDetailUiState
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class TaskDetailScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun ready_showsLifecycleAndAssignForUnassigned() {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskDetailScreen(
                    state =
                    TaskDetailUiState.Ready(
                        task =
                        OwnerTask(
                            id = "t1",
                            etag = "e1",
                            status = "open",
                            displayTitle = "Call painter",
                            assignmentEmail = null,
                            deliveryStatus = null,
                            noteBodies = emptyList(),
                            updatedAt = null
                        )
                    ),
                    onBack = {},
                    onRetry = {},
                    onStart = {},
                    onWaiting = {},
                    onResume = {},
                    onComplete = {},
                    onDismiss = {},
                    onAssign = {},
                    onNoteChanged = {},
                    onSaveNote = {}
                )
            }
        }

        composeRule.onNodeWithTag("task_detail_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_title").assertIsDisplayed()
        composeRule.onNodeWithText("Call painter").assertIsDisplayed()
        composeRule.onNodeWithTag("task_detail_ownership").assertIsDisplayed()
        composeRule.onNodeWithText("Start").assertIsDisplayed()
        composeRule.onNodeWithText("Complete").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Assign").performScrollTo().assertIsDisplayed()
    }
}
