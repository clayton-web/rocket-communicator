package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.aicommunication.assistant.messages.MessagesFilteredItem
import com.aicommunication.assistant.messages.MessagesIneligibilityReason
import com.aicommunication.assistant.messages.MessagesIntakeUiState
import com.aicommunication.assistant.messages.MessagesReviewItem
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
                    onSelect = {}
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
                    onSelect = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_empty").assertIsDisplayed()
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
    }

    @Test
    fun eligibleList_showsSenderAndTextWithoutEnablingReview() {
        var selected: String? = null
        composeRule.setContent {
            AicaaFoundationTheme {
                MessagesIntakeScreen(
                    state =
                    MessagesIntakeUiState.Ready(
                        eligible =
                        listOf(
                            MessagesReviewItem(
                                id = "key-1",
                                senderLabel = "Ada",
                                text = "Can you call me",
                                postedAtMs = 1_700_000_000_000L
                            )
                        ),
                        filtered = emptyList(),
                        listenerError = false,
                        shapes = emptyList()
                    ),
                    onBack = {},
                    onOpenNotificationAccess = {},
                    onRefreshAccess = {},
                    onSelect = { selected = it }
                )
            }
        }
        composeRule.onNodeWithText("Ada").assertIsDisplayed()
        composeRule.onNodeWithText("Can you call me").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_item_key-1").performClick()
        assertEquals("key-1", selected)
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
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
                    onSelect = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_empty").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_filtered").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_listener_error").assertIsDisplayed()
        composeRule.onNodeWithText("123456").assertDoesNotExist()
        composeRule.onNodeWithTag("gmail_review_button").assertDoesNotExist()
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
                    onSelect = {}
                )
            }
        }
        composeRule.onNodeWithTag("messages_intake_back").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_back").performClick()
        assertEquals(1, back)
    }
}
