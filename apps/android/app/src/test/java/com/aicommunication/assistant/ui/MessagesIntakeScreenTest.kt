package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.aicommunication.assistant.messages.MessagesFilteredItem
import com.aicommunication.assistant.messages.MessagesIneligibilityReason
import com.aicommunication.assistant.messages.MessagesIntakeUiState
import com.aicommunication.assistant.messages.MessagesNotificationShape
import com.aicommunication.assistant.messages.MessagesReviewItem
import com.aicommunication.assistant.messages.observation
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class MessagesIntakeScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun accessDisabled_offersSettingsAndOmitsReview() {
        var opened = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state = MessagesIntakeUiState.AccessDisabled,
                    onBack = {},
                    onOpenNotificationAccess = { opened += 1 },
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_access_needed").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_open_access").performClick()
        assertEquals(1, opened)
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
    }

    @Test
    fun emptyReady_isTruthfulAndHasNoReviewAction() {
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = emptyList(),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = emptyList()
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_empty").assertIsDisplayed()
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
    }

    @Test
    fun eligibleList_showsReviewDisabledUntilSelected() {
        var selected: String? = null
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = listOf(eligibleItem()),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = emptyList()
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = { selected = it },
                    onReview = { reviewed += 1 }
                )
            }
        }
        composeRule.onNodeWithText("Ada").assertIsDisplayed()
        composeRule.onNodeWithText("Can you call me").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_review_button").assertIsNotEnabled()
        composeRule.onNodeWithTag("messages_intake_item_key-1").performClick()
        assertEquals("key-1", selected)
        assertEquals(0, reviewed)
    }

    @Test
    fun selectedEligibleItem_enablesReviewWithRocket() {
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = listOf(eligibleItem()),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = emptyList(),
                        selectedId = "key-1"
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = { reviewed += 1 }
                )
            }
        }
        composeRule.onNodeWithTag("messages_review_button").assertIsEnabled()
        composeRule.onNodeWithText("Review with Rocket").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_review_button").performClick()
        assertEquals(1, reviewed)
    }

    @Test
    fun filteredOnly_cannotInvokeReview() {
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = emptyList(),
                        filtered =
                        listOf(
                            MessagesFilteredItem(
                                id = "otp",
                                reason = MessagesIneligibilityReason.OTP_OR_FINANCIAL,
                                senderLabel = null,
                                postedAtMs = 1L
                            )
                        ),
                        listenerError = false,
                        shapes = emptyList()
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = { reviewed += 1 }
                )
            }
        }
        composeRule.onNodeWithTag("messages_review_button").assertDoesNotExist()
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
        assertEquals(0, reviewed)
    }

    @Test
    fun filteredAndListenerError_areShownWithoutOtpBody() {
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = emptyList(),
                        filtered =
                        listOf(
                            MessagesFilteredItem(
                                id = "otp",
                                reason = MessagesIneligibilityReason.OTP_OR_FINANCIAL,
                                senderLabel = null,
                                postedAtMs = 1L
                            )
                        ),
                        listenerError = true,
                        shapes = emptyList()
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_empty").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_filtered").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_listener_error").assertIsDisplayed()
        composeRule.onNodeWithText("123456").assertDoesNotExist()
        composeRule.onNodeWithTag("gmail_review_button").assertDoesNotExist()
        composeRule.onNodeWithTag("messages_review_button").assertDoesNotExist()
    }

    @Test
    fun ambiguousReviewError_showsRetryOnTheReviewButton() {
        var reviewed = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = listOf(eligibleItem()),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = emptyList(),
                        selectedId = "key-1",
                        reviewError = "Rocket could not review that message right now. Try again.",
                        canRetryReview = true
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = { reviewed += 1 }
                )
            }
        }
        composeRule.onNodeWithTag("messages_review_error").assertIsDisplayed()
        composeRule.onNodeWithText("Retry").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_review_button").performClick()
        assertEquals(1, reviewed)
    }

    @Test
    fun back_isAvailableFromAccessDisabled() {
        var back = 0
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state = MessagesIntakeUiState.AccessDisabled,
                    onBack = { back += 1 },
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_back").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_back").performClick()
        assertEquals(1, back)
    }

    @Test
    fun debugShapes_showDerivedKeyFactsWithoutRawKeyOrTag() {
        val tag = "SYNTH_TAG_OPAQUE1"
        val key = "0|com.google.android.apps.messaging|1|$tag|1000"
        val shape =
            MessagesNotificationShape.from(
                observation(
                    notificationKey = key,
                    title = "SYNTH_TITLE",
                    text = "SYNTH_BODY_TEXT",
                    singlePersonName = "SYNTH_SENDER"
                )
            )
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible = emptyList(),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = listOf(shape)
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = {},
                    onReview = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_debug_shapes").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_debug_shape_0").assertIsDisplayed()
        composeRule.onNodeWithText(key, substring = true).assertDoesNotExist()
        composeRule.onNodeWithText(tag, substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("SYNTH_SENDER", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("SYNTH_TITLE", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("SYNTH_BODY_TEXT", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("keyTagClass=opaque_alphanumeric", substring = true)
            .assertIsDisplayed()
        composeRule.onNodeWithText("keySegments=5", substring = true).assertIsDisplayed()
    }

    private fun eligibleItem() = MessagesReviewItem(
        id = "key-1",
        senderLabel = "Ada",
        text = "Can you call me",
        postedAtMs = 1_700_000_000_000L
    )
}
