package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.aicommunication.assistant.tasks.GmailIntakeItemWire
import com.aicommunication.assistant.tasks.GmailIntakeUiState
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class GmailIntakeScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun ready_showsIntakeFieldsAndRequiresAnExplicitReviewTap() {
        var selected: String? = null
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = listOf(item("evt_1", "Please review")),
                        nextCursor = null
                    ),
                    onBack = {},
                    onSelect = { selected = it },
                    onReview = { reviewed += 1 },
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_intake_screen").assertIsDisplayed()
        composeRule.onNodeWithText("Please review").assertIsDisplayed()
        composeRule.onNodeWithText("sender@example.com").assertIsDisplayed()
        composeRule.onNodeWithText("Can you look at this").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_button").assertIsNotEnabled()

        composeRule.onNodeWithTag("gmail_intake_item_evt_1").performClick()
        assertEquals("evt_1", selected)
        assertEquals(0, reviewed)
    }

    @Test
    fun selectedMessage_enablesReviewWithRocket() {
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = listOf(item("evt_1", "Please review")),
                        nextCursor = null,
                        selectedId = "evt_1"
                    ),
                    onBack = {},
                    onSelect = {},
                    onReview = { reviewed += 1 },
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_review_button").assertIsEnabled()
        composeRule.onNodeWithText("Review with Rocket").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_button").performClick()
        assertEquals(1, reviewed)
    }

    @Test
    fun empty_showsTruthfulEmptyCopyAndKeepsReviewDisabled() {
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state = GmailIntakeUiState.Ready(items = emptyList(), nextCursor = null),
                    onBack = {},
                    onSelect = {},
                    onReview = {},
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_intake_empty").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_button").assertIsNotEnabled()
    }

    @Test
    fun error_offersRetry() {
        var retried = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state = GmailIntakeUiState.Error("Could not load Gmail. Try again."),
                    onBack = {},
                    onSelect = {},
                    onReview = {},
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = { retried += 1 },
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_intake_error").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_intake_retry").performClick()
        assertEquals(1, retried)
    }

    @Test
    fun ambiguousReviewError_showsRetryOnTheReviewButton() {
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = listOf(item("evt_1", "Please review")),
                        nextCursor = null,
                        selectedId = "evt_1",
                        reviewError = "Rocket could not review that email right now. Try again.",
                        canRetryReview = true
                    ),
                    onBack = {},
                    onSelect = {},
                    onReview = { reviewed += 1 },
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_review_error").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_button").performClick()
        assertEquals(1, reviewed)
    }

    @Test
    fun selectedMessage_enablesExcludeSenderWithoutActingUntilTapped() {
        var excluded = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = listOf(item("evt_1", "Please review")),
                        nextCursor = null,
                        selectedId = "evt_1"
                    ),
                    onBack = {},
                    onSelect = {},
                    onReview = {},
                    onExclude = { excluded += 1 },
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_exclude_button").assertIsEnabled()
        composeRule.onNodeWithText("Exclude sender").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_exclude_undo").assertDoesNotExist()
        assertEquals(0, excluded)
        composeRule.onNodeWithTag("gmail_exclude_button").performClick()
        assertEquals(1, excluded)
    }

    @Test
    fun excludeFailure_showsTruthfulErrorAndKeepsTheItem() {
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = listOf(item("evt_1", "Please review")),
                        nextCursor = null,
                        selectedId = "evt_1",
                        excludeError = "Could not exclude that sender. Try again."
                    ),
                    onBack = {},
                    onSelect = {},
                    onReview = {},
                    onExclude = {},
                    onUndoExclude = {},
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_exclude_error").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_intake_empty").assertDoesNotExist()
        composeRule.onNodeWithTag("gmail_intake_items").assertExists()
        composeRule.onNodeWithTag("gmail_exclude_undo").assertDoesNotExist()
    }

    @Test
    fun excludeSuccess_offersImmediateUndo() {
        var undone = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                GmailIntakeScreen(
                    state =
                    GmailIntakeUiState.Ready(
                        items = emptyList(),
                        nextCursor = null,
                        undoExclusionId = "gsex_1",
                        excludeSuccessMessage =
                        "Sender excluded. That sender will not appear for Review with Rocket."
                    ),
                    onBack = {},
                    onSelect = {},
                    onReview = {},
                    onExclude = {},
                    onUndoExclude = { undone += 1 },
                    onRetry = {},
                    onRefresh = {},
                    onLoadMore = {}
                )
            }
        }

        composeRule.onNodeWithTag("gmail_exclude_success").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_exclude_undo").assertIsEnabled()
        composeRule.onNodeWithTag("gmail_exclude_undo").performClick()
        assertEquals(1, undone)
    }

    private fun item(id: String, subject: String) = GmailIntakeItemWire(
        id = id,
        fromAddress = "sender@example.com",
        receivedAt = "2026-08-13T18:00:00.000Z",
        subject = subject,
        snippet = "Can you look at this"
    )
}
