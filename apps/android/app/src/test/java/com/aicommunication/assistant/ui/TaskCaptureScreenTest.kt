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
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextReplacement
import com.aicommunication.assistant.capture.CaptureSummaryPointWire
import com.aicommunication.assistant.capture.CaptureUiState
import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Read-only proposal result surface for Owner manual capture (S3.3b, D171).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class, qualifiers = "w411dp-h891dp")
class TaskCaptureScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun editing_disablesSaveWhenDraftEmpty() {
        setScreen(CaptureUiState.Editing())

        composeRule.onNodeWithTag("task_capture_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_save_button").assertIsNotEnabled()
    }

    @Test
    fun recovery_showsStoredTextWithRetryAndDiscard() {
        setScreen(
            CaptureUiState.Recovery(
                rawInput = "Call the roofer about the leak",
                errorMessage = "Cannot reach Rocket right now."
            )
        )

        composeRule.onNodeWithTag("capture_recovery").assertIsDisplayed()
        composeRule.onNodeWithText("Call the roofer about the leak").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_retry").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_discard").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_error").assertIsDisplayed()
    }

    @Test
    fun recovery_editingTheStoredTextReportsANewDraft() {
        val drafts = mutableListOf<String>()
        setScreen(
            CaptureUiState.Recovery(rawInput = "Call the roofer"),
            onDraftChanged = drafts::add
        )

        composeRule.onNodeWithTag("capture_field")
            .performTextReplacement("Call the roofer and the plumber")

        assertEquals(listOf("Call the roofer and the plumber"), drafts)
    }

    @Test
    fun zeroProposals_showsTruthfulResultAndKeepsTheCaptureText() {
        var rephrased = 0
        setScreen(
            CaptureUiState.Proposals(capturedText = "Thinking out loud", proposals = emptyList()),
            onRephrase = { rephrased += 1 }
        )

        composeRule.onNodeWithTag("capture_result").assertIsDisplayed()
        composeRule
            .onNodeWithText("Rocket didn't find anything actionable in this capture.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("You captured: Thinking out loud").assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_proposal_card").assertCountEquals(0)

        composeRule.onNodeWithTag("capture_rephrase_button").performClick()
        assertEquals(1, rephrased)
    }

    @Test
    fun oneProposal_showsASingleReadOnlyCardWithSummaryContent() {
        setScreen(
            CaptureUiState.Proposals(
                capturedText = "Call the roofer about the leak by Friday",
                proposals = listOf(
                    proposal(
                        id = "s1",
                        points = listOf(
                            summaryPoint("sp2", "deadline", "Due", order = 1, value = "Friday"),
                            summaryPoint(
                                "sp1",
                                "confirmed_fact",
                                "Captured",
                                order = 0,
                                value = "Call the roofer about the leak"
                            )
                        )
                    )
                )
            )
        )

        composeRule.onAllNodesWithTag("capture_proposal_card").assertCountEquals(1)
        composeRule
            .onNodeWithText("Call the roofer about the leak")
            .assertIsDisplayed()
        composeRule.onNodeWithText("Due: Friday").assertIsDisplayed()
        composeRule.onNodeWithText("Captured: Call the roofer about the leak").assertIsDisplayed()
    }

    @Test
    fun manyProposals_renderAllOfThemInABoundedScrollableList() {
        val ten = (1..10).map { index ->
            proposal(
                id = "s$index",
                points = listOf(
                    summaryPoint(
                        "sp$index",
                        "confirmed_fact",
                        "Captured",
                        order = 0,
                        value = "Proposal number $index"
                    )
                )
            )
        }
        setScreen(CaptureUiState.Proposals(capturedText = "A busy morning", proposals = ten))

        composeRule.onNodeWithTag("capture_proposal_list").assertIsDisplayed()
        composeRule.onNodeWithText("Proposal number 1").assertIsDisplayed()

        // Contract maximum is 10; the last card is reachable by scrolling, not by paging.
        composeRule.onNodeWithTag("capture_proposal_list").performScrollToIndex(9)
        composeRule.onNodeWithText("Proposal number 10").assertIsDisplayed()
    }

    @Test
    fun proposalResults_offerNoTaskOrLifecycleActions() {
        setScreen(
            CaptureUiState.Proposals(
                capturedText = "Call the roofer",
                proposals = listOf(
                    proposal(
                        id = "s1",
                        points = listOf(
                            summaryPoint(
                                "sp1",
                                "confirmed_fact",
                                "Captured",
                                order = 0,
                                value = "Call the roofer"
                            )
                        )
                    )
                )
            )
        )

        // S3.3b is read-only: no captured-Task pane, and no proposal lifecycle.
        listOf(
            "capture_success",
            "capture_open_task_button",
            "capture_assign_button",
            "capture_approve_button",
            "capture_dismiss_button",
            "capture_edit_button",
            "capture_merge_button"
        ).forEach { tag ->
            composeRule.onAllNodesWithTag(tag).assertCountEquals(0)
        }
        composeRule.onNodeWithTag("capture_another_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_done_button").assertIsDisplayed()
    }

    private fun setScreen(
        state: CaptureUiState,
        onDraftChanged: (String) -> Unit = {},
        onRephrase: () -> Unit = {}
    ) {
        composeRule.setContent {
            AicaaFoundationTheme {
                TaskCaptureScreen(
                    state = state,
                    onDraftChanged = onDraftChanged,
                    onSave = {},
                    onRetry = {},
                    onDiscard = {},
                    onRephrase = onRephrase,
                    onCaptureAnother = {},
                    onDone = {}
                )
            }
        }
    }

    private fun proposal(id: String, points: List<CaptureSummaryPointWire>) = TaskSuggestionWire(
        id = id,
        status = "pending",
        summaryPoints = points,
        version = 1,
        etag = "etag-$id",
        createdAt = "2026-08-12T15:00:00.000Z"
    )

    private fun summaryPoint(id: String, kind: String, label: String, order: Int, value: String?) =
        CaptureSummaryPointWire(id = id, kind = kind, label = label, order = order, value = value)
}
