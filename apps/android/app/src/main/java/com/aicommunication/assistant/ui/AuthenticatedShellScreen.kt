package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.contracts.models.Session
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

@Composable
fun AuthenticatedShellScreen(
    session: Session,
    signingOut: Boolean,
    onCapture: () -> Unit,
    onGmail: () -> Unit,
    onMessages: () -> Unit,
    onTasks: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    val display =
        session.displayName?.takeIf { it.isNotBlank() }
            ?: session.ownerId

    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("authenticated_shell"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.app_name),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.authenticated_shell_title),
            style = AicaaTextStyles.sectionTitle,
            color = AicaaColors.ink
        )
        Text(
            text = stringResource(R.string.authenticated_shell_subtitle),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )
        Text(
            text = "Signed in as $display",
            fontSize = 15.sp,
            color = AicaaColors.info,
            modifier = Modifier.testTag("authenticated_identity")
        )
        AicaaFilledButton(
            onClick = onCapture,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_entry_button")
        ) {
            Text(text = stringResource(R.string.capture_entry))
        }
        AicaaTextButton(
            onClick = onGmail,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("gmail_entry_button")
        ) {
            Text(text = stringResource(R.string.gmail_entry))
        }
        AicaaTextButton(
            onClick = onMessages,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("messages_entry_button")
        ) {
            Text(text = stringResource(R.string.messages_entry))
        }
        AicaaTextButton(
            onClick = onTasks,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("tasks_entry_button")
        ) {
            Text(text = stringResource(R.string.tasks_entry))
        }
        AicaaTextButton(
            onClick = onSignOut,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("sign_out_button")
        ) {
            Text(
                text =
                if (signingOut) {
                    stringResource(R.string.signing_out)
                } else {
                    stringResource(R.string.sign_out_button)
                }
            )
        }
    }
}
