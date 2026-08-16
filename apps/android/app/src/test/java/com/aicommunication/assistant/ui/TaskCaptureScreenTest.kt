package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
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
import com.aicommunication.assistant.capture.ProposalAcceptInteraction
import com.aicommunication.assistant.capture.ProposalDismissInteraction
import com.aicommunication.assistant.capture.ProposalEditInteraction
import com.aicommunication.assistant.capture.ProposalOrigin
import com.aicommunication.assistant.capture.ProposalResponsibility
import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.aicommunication.assistant.tasks.RecipientWire
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Capture proposal result surface (S3.3b / S5.3). Capture itself creates no Task; pending
 * proposals expose Accept, Edit, and Dismiss. Merge is not offered.
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
    fun gmailZeroProposals_showsTruthfulResultWithoutRephrase() {
        setScreen(
            CaptureUiState.Proposals(
                capturedText = "Quote revision",
                proposals = emptyList(),
                origin = ProposalOrigin.GmailReview
            )
        )

        composeRule.onNodeWithTag("capture_result").assertIsDisplayed()
        composeRule
            .onNodeWithText("Rocket didn't find anything actionable in this email.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("You reviewed: Quote revision").assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_proposal_card").assertCountEquals(0)
        composeRule.onNodeWithTag("capture_rephrase_button").assertDoesNotExist()
        composeRule.onNodeWithTag("gmail_review_another_button").assertIsDisplayed()
    }

    @Test
    fun messagesZeroProposals_showsTruthfulResultWithoutRephrase() {
        setScreen(
            CaptureUiState.Proposals(
                capturedText = "Can you call me tomorrow",
                proposals = emptyList(),
                origin = ProposalOrigin.MessagesReview
            )
        )

        composeRule.onNodeWithTag("capture_result").assertIsDisplayed()
        composeRule
            .onNodeWithText("Rocket didn't find anything actionable in this message.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("You reviewed: Can you call me tomorrow").assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_proposal_card").assertCountEquals(0)
        composeRule.onNodeWithTag("capture_rephrase_button").assertDoesNotExist()
        composeRule.onNodeWithTag("messages_review_another_button").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_another_button").assertDoesNotExist()
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
    fun proposalResults_exposeAcceptEditDismissAndNeverMerge() {
        var openedAccept = ""
        var openedEdit = ""
        var openedDismiss = ""
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
            ),
            onOpenAccept = { openedAccept = it },
            onOpenEdit = { openedEdit = it },
            onOpenDismiss = { openedDismiss = it }
        )

        composeRule.onNodeWithTag("capture_accept_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_edit_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_dismiss_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_button").performClick()
        composeRule.onNodeWithTag("capture_edit_button").performClick()
        composeRule.onNodeWithTag("capture_dismiss_button").performClick()
        assertEquals("s1", openedAccept)
        assertEquals("s1", openedEdit)
        assertEquals("s1", openedDismiss)
        listOf(
            "capture_success",
            "capture_open_task_button",
            "capture_assign_button",
            "capture_approve_button",
            "capture_merge_button",
            "capture_due_date",
            "capture_priority",
            "capture_reminder",
            "capture_recipient_edit",
            "capture_dismiss_reason"
        ).forEach { tag ->
            composeRule.onAllNodesWithTag(tag).assertCountEquals(0)
        }
        composeRule.onNodeWithTag("capture_another_button").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_done_button").assertIsDisplayed()
    }

    @Test
    fun acceptInteraction_offersMeAndRecipientsWithConfirmGatedOnSelection() {
        var confirmed = 0
        setScreen(
            acceptState(
                selected = null,
                recipients = listOf(
                    RecipientWire(
                        id = "rec-1",
                        displayName = "Alex Roofer",
                        email = "alex@example.com"
                    )
                )
            ),
            onConfirmAccept = { confirmed += 1 }
        )

        composeRule.onNodeWithTag("capture_accept_me").assertIsDisplayed()
        composeRule.onNodeWithText("Me / Owner").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_recipient_rec-1").assertIsDisplayed()
        composeRule.onNodeWithText("Alex Roofer").assertIsDisplayed()
        composeRule.onNodeWithText("alex@example.com").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_confirm").assertIsNotEnabled()
        composeRule.onAllNodesWithTag("capture_edit_button").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_dismiss_button").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_merge_button").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_due_date").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_priority").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_reminder").assertCountEquals(0)

        composeRule.onNodeWithTag("capture_accept_confirm").performClick()
        assertEquals(0, confirmed)
    }

    @Test
    fun acceptInteraction_confirmEnabledAfterOwnerSelection() {
        var confirmed = 0
        setScreen(
            acceptState(selected = ProposalResponsibility.Owner),
            onConfirmAccept = { confirmed += 1 }
        )

        composeRule.onNodeWithTag("capture_accept_confirm").assertIsEnabled()
        composeRule.onNodeWithTag("capture_accept_confirm").performClick()
        assertEquals(1, confirmed)
    }

    @Test
    fun acceptInteraction_mutationStateDisablesDuplicateConfirm() {
        setScreen(
            acceptState(
                selected = ProposalResponsibility.Owner,
                approving = true
            )
        )

        composeRule.onNodeWithTag("capture_accept_confirm").assertIsNotEnabled()
        composeRule.onNodeWithText("Accepting…").assertIsDisplayed()
    }

    @Test
    fun acceptInteraction_rendersRecoverableMessageAndStatusRetry() {
        setScreen(
            acceptState(
                selected = ProposalResponsibility.Owner,
                recoveryReadFailed = true,
                message = "Rocket could not confirm whether this proposal was accepted."
            )
        )

        composeRule.onNodeWithTag("capture_accept_message").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_retry_recovery").assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_accept_confirm").assertCountEquals(0)
    }

    @Test
    fun editInteraction_rendersOnlyAuthorizedWordingFields() {
        var saved = 0
        setScreen(
            editState(
                points = listOf(
                    summaryPoint(
                        "sp1",
                        "confirmed_fact",
                        "Captured",
                        order = 0,
                        value = "Call the roofer"
                    ),
                    summaryPoint("sp2", "amount", "Amount", order = 1, value = null)
                )
            ),
            onSaveEdit = { saved += 1 }
        )

        composeRule.onNodeWithTag("capture_edit_field_sp1").assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_edit_field_sp2").assertCountEquals(0)
        composeRule.onNodeWithTag("capture_edit_readonly_sp2").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_edit_save").assertIsEnabled()
        composeRule.onAllNodesWithTag("capture_due_date").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_priority").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_reminder").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_recipient_edit").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_merge_button").assertCountEquals(0)
        composeRule.onNodeWithTag("capture_edit_save").performClick()
        assertEquals(1, saved)
    }

    @Test
    fun editInteraction_disablesSaveWhileInFlight() {
        setScreen(editState(saving = true))
        composeRule.onNodeWithTag("capture_edit_save").assertIsNotEnabled()
        composeRule.onNodeWithText("Saving…").assertIsDisplayed()
    }

    @Test
    fun editInteraction_disablesSaveWhenWordingIsBlank() {
        setScreen(
            editState(
                points = listOf(
                    summaryPoint(
                        "sp1",
                        "confirmed_fact",
                        "Captured",
                        order = 0,
                        value = "   "
                    )
                )
            )
        )
        composeRule.onNodeWithTag("capture_edit_save").assertIsNotEnabled()
    }

    @Test
    fun dismissConfirmation_explainsProposalDismissalAndHasNoReasonField() {
        var confirmed = 0
        setScreen(dismissState(), onConfirmDismiss = { confirmed += 1 })

        composeRule.onNodeWithTag("capture_dismiss_confirm_body").assertIsDisplayed()
        composeRule.onNodeWithText("This dismisses the proposal. It does not create a Task.")
            .assertIsDisplayed()
        composeRule.onAllNodesWithTag("capture_dismiss_reason").assertCountEquals(0)
        composeRule.onAllNodesWithTag("capture_merge_button").assertCountEquals(0)
        composeRule.onNodeWithTag("capture_dismiss_confirm").assertIsEnabled()
        composeRule.onNodeWithTag("capture_dismiss_confirm").performClick()
        assertEquals(1, confirmed)
    }

    @Test
    fun dismissConfirmation_disablesDuplicateConfirmWhileInFlight() {
        setScreen(dismissState(dismissing = true))

        composeRule.onNodeWithTag("capture_dismiss_confirm").assertIsNotEnabled()
        composeRule.onNodeWithText("Dismissing…").assertIsDisplayed()
    }

    private fun acceptState(
        selected: ProposalResponsibility?,
        recipients: List<RecipientWire> = emptyList(),
        approving: Boolean = false,
        recoveryReadFailed: Boolean = false,
        message: String? = null
    ) = CaptureUiState.Proposals(
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
        ),
        accept =
        ProposalAcceptInteraction(
            proposalId = "s1",
            selectedResponsibility = selected,
            recipients = recipients,
            approving = approving,
            recoveryReadFailed = recoveryReadFailed,
            message = message
        )
    )

    private fun editState(
        points: List<CaptureSummaryPointWire> =
            listOf(
                summaryPoint(
                    "sp1",
                    "confirmed_fact",
                    "Captured",
                    order = 0,
                    value = "Call the roofer"
                )
            ),
        saving: Boolean = false
    ) = CaptureUiState.Proposals(
        capturedText = "Call the roofer",
        proposals = listOf(proposal(id = "s1", points = points)),
        edit =
        ProposalEditInteraction(
            proposalId = "s1",
            draftPoints = points,
            saving = saving
        )
    )

    private fun dismissState(dismissing: Boolean = false) = CaptureUiState.Proposals(
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
        ),
        dismiss = ProposalDismissInteraction(proposalId = "s1", dismissing = dismissing)
    )

    private fun setScreen(
        state: CaptureUiState,
        onDraftChanged: (String) -> Unit = {},
        onRephrase: () -> Unit = {},
        onOpenAccept: (String) -> Unit = {},
        onConfirmAccept: () -> Unit = {},
        onOpenEdit: (String) -> Unit = {},
        onSaveEdit: () -> Unit = {},
        onOpenDismiss: (String) -> Unit = {},
        onConfirmDismiss: () -> Unit = {}
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
                    onDone = {},
                    onOpenAccept = onOpenAccept,
                    onConfirmAccept = onConfirmAccept,
                    onOpenEdit = onOpenEdit,
                    onSaveEdit = onSaveEdit,
                    onOpenDismiss = onOpenDismiss,
                    onConfirmDismiss = onConfirmDismiss
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
