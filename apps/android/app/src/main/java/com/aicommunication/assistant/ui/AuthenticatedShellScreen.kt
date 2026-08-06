package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.contracts.models.Session

@Composable
fun AuthenticatedShellScreen(
    session: Session,
    signingOut: Boolean,
    onCapture: () -> Unit,
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
            .background(Color(0xFFF5F5F4))
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("authenticated_shell"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.app_name),
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF1C1917),
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.authenticated_shell_title),
            fontSize = 20.sp,
            fontWeight = FontWeight.Medium,
            color = Color(0xFF1C1917)
        )
        Text(
            text = stringResource(R.string.authenticated_shell_subtitle),
            fontSize = 16.sp,
            color = Color(0xFF57534E)
        )
        Text(
            text = "Signed in as $display",
            fontSize = 15.sp,
            color = Color(0xFF0F766E),
            modifier = Modifier.testTag("authenticated_identity")
        )
        Button(
            onClick = onCapture,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_entry_button")
        ) {
            Text(text = stringResource(R.string.capture_entry))
        }
        Button(
            onClick = onTasks,
            enabled = !signingOut,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("tasks_entry_button")
        ) {
            Text(text = stringResource(R.string.tasks_entry))
        }
        Button(
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
