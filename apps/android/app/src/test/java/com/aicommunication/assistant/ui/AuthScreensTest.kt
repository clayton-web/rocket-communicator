package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.aicommunication.assistant.contracts.models.AuthenticatedRole
import com.aicommunication.assistant.contracts.models.Session
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class AuthScreensTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun signInScreen_showsOwnerSignInCopy() {
        composeRule.setContent {
            AicaaFoundationTheme {
                SignInScreen(
                    errorMessage = null,
                    connectivityIssue = false,
                    signingIn = false,
                    onSignIn = {},
                    onRetry = {}
                )
            }
        }

        composeRule.onNodeWithTag("sign_in_screen").assertIsDisplayed()
        composeRule.onNodeWithText("Owner sign in").assertIsDisplayed()
        composeRule.onNodeWithText("Sign in with Google").assertIsDisplayed()
    }

    @Test
    fun authenticatedShell_showsIdentityAndSignOut() {
        composeRule.setContent {
            AicaaFoundationTheme {
                AuthenticatedShellScreen(
                    session =
                    Session(
                        ownerId = "owner-1",
                        organizationId = "org-1",
                        role = AuthenticatedRole.owner,
                        displayName = "Ada Owner"
                    ),
                    signingOut = false,
                    onCapture = {},
                    onTasks = {},
                    onSignOut = {}
                )
            }
        }

        composeRule.onNodeWithTag("authenticated_shell").assertIsDisplayed()
        composeRule.onNodeWithText("Signed in as Ada Owner").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_entry_button").assertIsDisplayed()
        composeRule.onNodeWithTag("tasks_entry_button").assertIsDisplayed()
        composeRule.onNodeWithText("Capture").assertIsDisplayed()
        composeRule.onNodeWithText("Tasks").assertIsDisplayed()
        composeRule.onNodeWithText("Sign out").assertIsDisplayed()
    }
}
