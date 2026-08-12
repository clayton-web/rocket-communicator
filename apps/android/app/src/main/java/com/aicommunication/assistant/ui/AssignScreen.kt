package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.tasks.HandoffUiState
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

@Composable
fun AssignScreen(
    state: HandoffUiState,
    onBack: () -> Unit,
    onRetryLoad: () -> Unit,
    onSelectRecipient: (String) -> Unit,
    onOpenConfirm: () -> Unit,
    onCloseConfirm: () -> Unit,
    onConfirm: () -> Unit,
    onRetryHandoff: () -> Unit,
    onOpenGmailSetup: () -> Unit,
    onCreateNameChanged: (String) -> Unit,
    onCreateEmailChanged: (String) -> Unit,
    onCreateRecipient: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.paper)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("assign_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.handoff_title),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.handoff_subtitle),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )

        when (state) {
            HandoffUiState.Loading -> {
                Spacer(modifier = Modifier.weight(1f))
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                Spacer(modifier = Modifier.weight(1f))
            }
            is HandoffUiState.Error -> {
                Text(text = state.message, color = AicaaColors.critical)
                Button(onClick = onRetryLoad, modifier = Modifier.fillMaxWidth()) {
                    Text(text = stringResource(R.string.retry))
                }
            }
            is HandoffUiState.Ready -> {
                Column(
                    modifier =
                    Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = state.task.displayTitle,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.testTag("assign_task_title")
                    )
                    Text(text = state.task.ownershipLabel, color = AicaaColors.muted)

                    if (state.banner != null) {
                        val color =
                            when (state.bannerTone) {
                                HandoffUiState.BannerTone.Success -> AicaaColors.accent
                                HandoffUiState.BannerTone.Warning -> AicaaColors.caution
                                HandoffUiState.BannerTone.Error -> AicaaColors.critical
                                HandoffUiState.BannerTone.Info -> Color(0xFF44403C)
                            }
                        Text(
                            text = state.banner,
                            color = color,
                            modifier = Modifier.testTag("assign_banner")
                        )
                    }
                    if (state.errorMessage != null) {
                        Text(text = state.errorMessage, color = AicaaColors.critical)
                    }

                    if (state.notConnected || state.needsReconsent) {
                        Text(
                            text =
                            if (state.notConnected) {
                                stringResource(R.string.handoff_gmail_not_connected)
                            } else {
                                stringResource(R.string.handoff_reconsent_instructions)
                            },
                            color = AicaaColors.caution
                        )
                        Button(
                            onClick = onOpenGmailSetup,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("assign_gmail_setup")
                        ) {
                            Text(text = stringResource(R.string.handoff_open_gmail_setup))
                        }
                    }

                    Text(
                        text = stringResource(R.string.handoff_recipients_heading),
                        fontWeight = FontWeight.Medium
                    )
                    if (state.recipients.isEmpty()) {
                        Text(
                            text = stringResource(R.string.handoff_no_recipients),
                            color = AicaaColors.muted,
                            modifier = Modifier.testTag("assign_no_recipients")
                        )
                    } else {
                        state.recipients.forEach { recipient ->
                            Row(
                                modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .selectable(
                                        selected = state.selectedRecipientId == recipient.id,
                                        onClick = { onSelectRecipient(recipient.id) },
                                        role = Role.RadioButton
                                    )
                                    .padding(vertical = 6.dp)
                                    .testTag("assign_recipient_${recipient.id}"),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = state.selectedRecipientId == recipient.id,
                                    onClick = { onSelectRecipient(recipient.id) }
                                )
                                Column(modifier = Modifier.padding(start = 8.dp)) {
                                    Text(
                                        text = recipient.displayName,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = recipient.email,
                                        color = AicaaColors.muted,
                                        fontSize = 14.sp
                                    )
                                }
                            }
                        }
                    }

                    OutlinedTextField(
                        value = state.createName,
                        onValueChange = onCreateNameChanged,
                        enabled = !state.creatingRecipient,
                        modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("assign_create_name"),
                        placeholder = { Text(text = stringResource(R.string.handoff_create_name)) }
                    )
                    OutlinedTextField(
                        value = state.createEmail,
                        onValueChange = onCreateEmailChanged,
                        enabled = !state.creatingRecipient,
                        modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("assign_create_email"),
                        placeholder = { Text(text = stringResource(R.string.handoff_create_email)) }
                    )
                    TextButton(
                        onClick = onCreateRecipient,
                        enabled =
                        !state.creatingRecipient &&
                            state.createName.trim().isNotEmpty() &&
                            state.createEmail.trim().isNotEmpty(),
                        modifier = Modifier.testTag("assign_create_recipient")
                    ) {
                        Text(text = stringResource(R.string.handoff_create_recipient))
                    }

                    if (state.task.canAssign && state.successDeliveryPath == null) {
                        Button(
                            onClick = onOpenConfirm,
                            enabled = state.canConfirm,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("assign_confirm_entry")
                        ) {
                            Text(
                                text =
                                if (state.submitting) {
                                    stringResource(R.string.handoff_sending)
                                } else {
                                    stringResource(R.string.handoff_confirm)
                                }
                            )
                        }
                    }

                    if (state.pending != null && state.successDeliveryPath == null) {
                        Button(
                            onClick = onRetryHandoff,
                            enabled = !state.submitting,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("assign_retry")
                        ) {
                            Text(
                                text =
                                if (state.showRetryAfterReconsent) {
                                    stringResource(R.string.handoff_retry)
                                } else {
                                    stringResource(R.string.handoff_check_status)
                                }
                            )
                        }
                    }
                }

                if (state.confirming) {
                    AlertDialog(
                        onDismissRequest = onCloseConfirm,
                        title = { Text(text = stringResource(R.string.handoff_confirm_title)) },
                        text = {
                            Text(
                                text = stringResource(R.string.handoff_confirm_body),
                                modifier = Modifier.testTag("assign_confirm_body")
                            )
                        },
                        confirmButton = {
                            Button(
                                onClick = onConfirm,
                                modifier = Modifier.testTag("assign_confirm_send")
                            ) {
                                Text(text = stringResource(R.string.handoff_confirm_action))
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = onCloseConfirm) {
                                Text(text = stringResource(R.string.handoff_cancel))
                            }
                        }
                    )
                }
            }
        }

        TextButton(onClick = onBack, modifier = Modifier.testTag("assign_back")) {
            Text(text = stringResource(R.string.tasks_back))
        }
    }
}
