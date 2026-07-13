package com.aicommunication.assistant

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Local instrumentation smoke test. Not run in A1 CI (no emulator pipeline).
 */
@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun launchesFoundationPlaceholder() {
        composeRule.onNodeWithText("AI Communication Action Assistant").assertIsDisplayed()
        composeRule.onNodeWithText("Android foundation is active.").assertIsDisplayed()
        composeRule.onNodeWithText("No communication capture is enabled.").assertIsDisplayed()
    }
}
