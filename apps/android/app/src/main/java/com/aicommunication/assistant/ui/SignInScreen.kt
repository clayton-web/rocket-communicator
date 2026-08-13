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
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

@Composable
fun SignInScreen(
    errorMessage: String?,
    connectivityIssue: Boolean,
    signingIn: Boolean,
    onSignIn: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("sign_in_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.app_name),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.sign_in_title),
            style = AicaaTextStyles.sectionTitle,
            color = AicaaColors.ink
        )
        Text(
            text = stringResource(R.string.sign_in_body),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )
        if (errorMessage != null) {
            Text(
                text = errorMessage,
                fontSize = 15.sp,
                color = AicaaColors.destructive,
                modifier = Modifier.testTag("sign_in_error")
            )
        }
        AicaaFilledButton(
            onClick = onSignIn,
            enabled = !signingIn,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("sign_in_button")
        ) {
            Text(
                text =
                if (signingIn) {
                    stringResource(R.string.signing_in)
                } else {
                    stringResource(R.string.sign_in_button)
                }
            )
        }
        if (connectivityIssue) {
            AicaaTextButton(
                onClick = onRetry,
                modifier = Modifier.testTag("sign_in_retry")
            ) {
                Text(text = stringResource(R.string.retry))
            }
        }
    }
}
