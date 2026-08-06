package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.aicommunication.assistant.AicaaFoundationTheme
import com.aicommunication.assistant.capture.CaptureUiState
import com.aicommunication.assistant.capture.CapturedTask
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class TaskCaptureScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun editing_disablesSaveWhenDraftEmpty() {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskCaptureScreen(
                    state = CaptureUiState.Editing(),
                    onDraftChanged = {},
                    onSave = {},
                    onCaptureAnother = {},
                    onOpenTask = {},
                    onAssign = {},
                    onDone = {},
                    onRetry = {}
                )
            }
        }

        composeRule.onNodeWithTag("task_capture_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_save_button").assertIsNotEnabled()
    }

    @Test
    fun captured_showsServerConfirmedTitle() {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskCaptureScreen(
                    state =
                    CaptureUiState.Captured(
                        CapturedTask(
                            id = "t1",
                            etag = "e1",
                            status = "active",
                            displayTitle = "Call the painter"
                        )
                    ),
                    onDraftChanged = {},
                    onSave = {},
                    onCaptureAnother = {},
                    onOpenTask = {},
                    onAssign = {},
                    onDone = {},
                    onRetry = {}
                )
            }
        }

        composeRule.onNodeWithTag("capture_success").assertIsDisplayed()
        composeRule.onNodeWithText("Saved").assertIsDisplayed()
        composeRule.onNodeWithText("Call the painter").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_another_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_open_task_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_assign_button").assertIsDisplayed()
    }
}
