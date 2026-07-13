package com.aicommunication.assistant

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class FoundationPlaceholderTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun foundationPlaceholder_showsExpectedCopy() {
        composeRule.setContent {
            AicaaFoundationTheme {
                FoundationPlaceholder()
            }
        }

        composeRule.onNodeWithText("AI Communication Action Assistant").assertIsDisplayed()
        composeRule.onNodeWithText("Android foundation is active.").assertIsDisplayed()
        composeRule.onNodeWithText("No communication capture is enabled.").assertIsDisplayed()
    }
}
