package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskListUiState
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class TaskListScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun ready_showsTaskAndOwnerWorkLabel() {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskListScreen(
                    state =
                    TaskListUiState.Ready(
                        tasks =
                        listOf(
                            OwnerTask(
                                id = "t1",
                                etag = "e1",
                                status = "open",
                                displayTitle = "Order lumber",
                                assignmentEmail = null,
                                deliveryStatus = null,
                                noteBodies = emptyList(),
                                updatedAt = null
                            )
                        ),
                        nextCursor = null
                    ),
                    onBack = {},
                    onOpenTask = {},
                    onCapture = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("task_list_screen").assertIsDisplayed()
        composeRule.onNodeWithText("Order lumber").assertIsDisplayed()
        composeRule
            .onNodeWithText("Open · Owner work (unassigned)", substring = true)
            .assertIsDisplayed()
    }

    @Test
    fun empty_offersCapture() {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskListScreen(
                    state = TaskListUiState.Ready(tasks = emptyList(), nextCursor = null),
                    onBack = {},
                    onOpenTask = {},
                    onCapture = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("task_list_empty").assertIsDisplayed()
        composeRule.onNodeWithTag("task_list_capture").assertIsDisplayed()
    }
}
