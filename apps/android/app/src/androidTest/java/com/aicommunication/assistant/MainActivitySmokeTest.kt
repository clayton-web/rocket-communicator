package com.aicommunication.assistant

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Local instrumentation smoke test. Not run in CI (no emulator pipeline).
 */
@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun launchesAuthGate() {
        // Without configured Supabase credentials the app settles on the sign-in gate
        // (or briefly loading). Either auth surface proves the A9.0 shell is wired.
        composeRule.waitForIdle()
        val signIn = composeRule.onNodeWithTag("sign_in_screen")
        val loading = composeRule.onNodeWithTag("auth_loading")
        try {
            signIn.assertIsDisplayed()
        } catch (_: AssertionError) {
            loading.assertIsDisplayed()
        }
    }
}
