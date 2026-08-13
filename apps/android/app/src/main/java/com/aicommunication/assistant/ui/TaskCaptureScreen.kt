package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.capture.CaptureSummaryPointWire
import com.aicommunication.assistant.capture.CaptureUiState
import com.aicommunication.assistant.capture.ProposalAcceptInteraction
import com.aicommunication.assistant.capture.ProposalDismissInteraction
import com.aicommunication.assistant.capture.ProposalEditInteraction
import com.aicommunication.assistant.capture.ProposalResponsibility
import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.aicommunication.assistant.capture.deriveProposalTitle
import com.aicommunication.assistant.capture.hasEditableWording
import com.aicommunication.assistant.capture.isAcceptable
import com.aicommunication.assistant.capture.orderedSummaryPoints
import com.aicommunication.assistant.capture.summaryPointDetail
import com.aicommunication.assistant.tasks.RecipientWire
import com.aicommunication.assistant.ui.theme.AicaaCircularProgressIndicator
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaDestructiveTextButton
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaOutlinedTextField
import com.aicommunication.assistant.ui.theme.AicaaRadioButton
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

/**
 * Owner manual capture (S3.3b / S5.3, D171 / D176). Capture itself creates no Task. Pending
 * proposals may expose Accept, Edit, and Dismiss. Merge is not offered. Edit changes summary-point
 * wording only. Dismiss creates no Task.
 */
@Composable
fun TaskCaptureScreen(
    state: CaptureUiState,
    onDraftChanged: (String) -> Unit,
    onSave: () -> Unit,
    onRetry: () -> Unit,
    onDiscard: () -> Unit,
    onRephrase: () -> Unit,
    onCaptureAnother: () -> Unit,
    onDone: () -> Unit,
    onOpenAccept: (String) -> Unit = {},
    onCancelAccept: () -> Unit = {},
    onSelectOwnerResponsibility: () -> Unit = {},
    onSelectRecipientResponsibility: (String) -> Unit = {},
    onConfirmAccept: () -> Unit = {},
    onRetryAcceptRecipients: () -> Unit = {},
    onRetryAcceptRecovery: () -> Unit = {},
    onOpenEdit: (String) -> Unit = {},
    onCancelEdit: () -> Unit = {},
    onUpdateEditPoint: (String, String) -> Unit = { _, _ -> },
    onSaveEdit: () -> Unit = {},
    onOpenDismiss: (String) -> Unit = {},
    onCancelDismiss: () -> Unit = {},
    onConfirmDismiss: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    when (state) {
        is CaptureUiState.Editing ->
            CaptureEditingPane(
                state = state,
                onDraftChanged = onDraftChanged,
                onSave = onSave,
                onDone = onDone,
                modifier = modifier
            )
        is CaptureUiState.Recovery ->
            CaptureRecoveryPane(
                state = state,
                onDraftChanged = onDraftChanged,
                onRetry = onRetry,
                onDiscard = onDiscard,
                onDone = onDone,
                modifier = modifier
            )
        is CaptureUiState.Proposals ->
            CaptureProposalsPane(
                state = state,
                onRephrase = onRephrase,
                onCaptureAnother = onCaptureAnother,
                onDone = onDone,
                onOpenAccept = onOpenAccept,
                onCancelAccept = onCancelAccept,
                onSelectOwnerResponsibility = onSelectOwnerResponsibility,
                onSelectRecipientResponsibility = onSelectRecipientResponsibility,
                onConfirmAccept = onConfirmAccept,
                onRetryAcceptRecipients = onRetryAcceptRecipients,
                onRetryAcceptRecovery = onRetryAcceptRecovery,
                onOpenEdit = onOpenEdit,
                onCancelEdit = onCancelEdit,
                onUpdateEditPoint = onUpdateEditPoint,
                onSaveEdit = onSaveEdit,
                onOpenDismiss = onOpenDismiss,
                onCancelDismiss = onCancelDismiss,
                onConfirmDismiss = onConfirmDismiss,
                modifier = modifier
            )
    }
}

@Composable
private fun CaptureEditingPane(
    state: CaptureUiState.Editing,
    onDraftChanged: (String) -> Unit,
    onSave: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    CapturePane(
        modifier = modifier,
        testTag = "task_capture_screen"
    ) {
        PaneHeading(text = stringResource(R.string.capture_title))
        PaneBody(text = stringResource(R.string.capture_subtitle))
        CaptureField(
            value = state.draft,
            onValueChange = onDraftChanged,
            enabled = !state.submitting,
            modifier = Modifier.focusRequester(focusRequester)
        )
        PaneError(message = state.errorMessage)
        Spacer(modifier = Modifier.weight(1f))
        AicaaFilledButton(
            onClick = onSave,
            enabled = !state.submitting && state.draft.trim().isNotEmpty(),
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_save_button")
        ) {
            Text(
                text =
                if (state.submitting) {
                    stringResource(R.string.capture_saving)
                } else {
                    stringResource(R.string.capture_save)
                }
            )
        }
        AicaaTextButton(
            onClick = onDone,
            enabled = !state.submitting,
            modifier = Modifier.testTag("capture_cancel_button")
        ) {
            Text(text = stringResource(R.string.capture_cancel))
        }
    }
}

@Composable
private fun CaptureRecoveryPane(
    state: CaptureUiState.Recovery,
    onDraftChanged: (String) -> Unit,
    onRetry: () -> Unit,
    onDiscard: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier
) {
    CapturePane(
        modifier = modifier,
        testTag = "capture_recovery"
    ) {
        PaneHeading(text = stringResource(R.string.capture_recovery_title))
        PaneBody(text = stringResource(R.string.capture_recovery_body))
        CaptureField(
            value = state.rawInput,
            onValueChange = onDraftChanged,
            enabled = !state.submitting
        )
        PaneError(message = state.errorMessage)
        Spacer(modifier = Modifier.weight(1f))
        AicaaFilledButton(
            onClick = onRetry,
            enabled = !state.submitting,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_retry")
        ) {
            Text(
                text =
                if (state.submitting) {
                    stringResource(R.string.capture_saving)
                } else {
                    stringResource(R.string.retry)
                }
            )
        }
        AicaaTextButton(
            onClick = onDiscard,
            enabled = !state.submitting,
            modifier = Modifier.testTag("capture_discard")
        ) {
            Text(text = stringResource(R.string.capture_discard))
        }
        AicaaTextButton(
            onClick = onDone,
            enabled = !state.submitting,
            modifier = Modifier.testTag("capture_cancel_button")
        ) {
            Text(text = stringResource(R.string.capture_cancel))
        }
    }
}

@Composable
private fun CaptureProposalsPane(
    state: CaptureUiState.Proposals,
    onRephrase: () -> Unit,
    onCaptureAnother: () -> Unit,
    onDone: () -> Unit,
    onOpenAccept: (String) -> Unit,
    onCancelAccept: () -> Unit,
    onSelectOwnerResponsibility: () -> Unit,
    onSelectRecipientResponsibility: (String) -> Unit,
    onConfirmAccept: () -> Unit,
    onRetryAcceptRecipients: () -> Unit,
    onRetryAcceptRecovery: () -> Unit,
    onOpenEdit: (String) -> Unit,
    onCancelEdit: () -> Unit,
    onUpdateEditPoint: (String, String) -> Unit,
    onSaveEdit: () -> Unit,
    onOpenDismiss: (String) -> Unit,
    onCancelDismiss: () -> Unit,
    onConfirmDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val empty = state.proposals.isEmpty()
    val interactionBusy = state.interactionBusy
    CapturePane(
        modifier = modifier,
        testTag = "capture_result"
    ) {
        PaneHeading(
            text =
            if (empty) {
                stringResource(R.string.capture_result_empty_title)
            } else {
                stringResource(R.string.capture_result_title)
            }
        )
        Text(
            text =
            if (empty) {
                stringResource(R.string.capture_result_empty_body)
            } else {
                stringResource(R.string.capture_result_body)
            },
            style = AicaaTextStyles.body,
            color = AicaaColors.muted,
            modifier =
            Modifier.testTag(if (empty) "capture_result_empty" else "capture_result_summary")
        )
        Text(
            text = stringResource(R.string.capture_result_source, state.capturedText),
            fontSize = 15.sp,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("capture_result_source")
        )
        if (state.notice != null) {
            Text(
                text = state.notice,
                fontSize = 15.sp,
                color = AicaaColors.warning,
                modifier = Modifier.testTag("capture_proposal_notice")
            )
        }
        if (empty) {
            Spacer(modifier = Modifier.weight(1f))
            AicaaTextButton(
                onClick = onRephrase,
                enabled = !interactionBusy,
                modifier = Modifier.testTag("capture_rephrase_button")
            ) {
                Text(text = stringResource(R.string.capture_rephrase))
            }
        } else {
            LazyColumn(
                modifier =
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag("capture_proposal_list"),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(items = state.proposals, key = TaskSuggestionWire::id) { proposal ->
                    ProposalCard(
                        proposal = proposal,
                        accept = state.accept?.takeIf { it.proposalId == proposal.id },
                        edit = state.edit?.takeIf { it.proposalId == proposal.id },
                        interactionBusy = interactionBusy,
                        onOpenAccept = onOpenAccept,
                        onCancelAccept = onCancelAccept,
                        onSelectOwnerResponsibility = onSelectOwnerResponsibility,
                        onSelectRecipientResponsibility = onSelectRecipientResponsibility,
                        onConfirmAccept = onConfirmAccept,
                        onRetryAcceptRecipients = onRetryAcceptRecipients,
                        onRetryAcceptRecovery = onRetryAcceptRecovery,
                        onOpenEdit = onOpenEdit,
                        onCancelEdit = onCancelEdit,
                        onUpdateEditPoint = onUpdateEditPoint,
                        onSaveEdit = onSaveEdit,
                        onOpenDismiss = onOpenDismiss
                    )
                }
            }
        }
        AicaaFilledButton(
            onClick = onCaptureAnother,
            enabled = !interactionBusy,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_another_button")
        ) {
            Text(text = stringResource(R.string.capture_another))
        }
        AicaaTextButton(
            onClick = onDone,
            enabled = !interactionBusy,
            modifier = Modifier.testTag("capture_done_button")
        ) {
            Text(text = stringResource(R.string.capture_done))
        }
        if (state.dismiss != null) {
            ProposalDismissDialog(
                dismiss = state.dismiss,
                onCancelDismiss = onCancelDismiss,
                onConfirmDismiss = onConfirmDismiss
            )
        }
    }
}

@Composable
private fun ProposalCard(
    proposal: TaskSuggestionWire,
    accept: ProposalAcceptInteraction?,
    edit: ProposalEditInteraction?,
    interactionBusy: Boolean,
    onOpenAccept: (String) -> Unit,
    onCancelAccept: () -> Unit,
    onSelectOwnerResponsibility: () -> Unit,
    onSelectRecipientResponsibility: (String) -> Unit,
    onConfirmAccept: () -> Unit,
    onRetryAcceptRecipients: () -> Unit,
    onRetryAcceptRecovery: () -> Unit,
    onOpenEdit: (String) -> Unit,
    onCancelEdit: () -> Unit,
    onUpdateEditPoint: (String, String) -> Unit,
    onSaveEdit: () -> Unit,
    onOpenDismiss: (String) -> Unit
) {
    Card(
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("capture_proposal_card")
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = deriveProposalTitle(proposal),
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                color = AicaaColors.ink,
                modifier = Modifier.testTag("capture_proposal_title")
            )
            if (edit == null) {
                orderedSummaryPoints(proposal).forEach { point ->
                    Text(
                        text = "${point.label}: ${summaryPointDetail(point)}",
                        fontSize = 15.sp,
                        color = AicaaColors.ink
                    )
                }
            }
            if (proposal.isAcceptable) {
                when {
                    accept != null ->
                        ProposalAcceptPane(
                            accept = accept,
                            onCancelAccept = onCancelAccept,
                            onSelectOwnerResponsibility = onSelectOwnerResponsibility,
                            onSelectRecipientResponsibility = onSelectRecipientResponsibility,
                            onConfirmAccept = onConfirmAccept,
                            onRetryAcceptRecipients = onRetryAcceptRecipients,
                            onRetryAcceptRecovery = onRetryAcceptRecovery
                        )
                    edit != null ->
                        ProposalEditPane(
                            edit = edit,
                            onCancelEdit = onCancelEdit,
                            onUpdateEditPoint = onUpdateEditPoint,
                            onSaveEdit = onSaveEdit
                        )
                    else ->
                        ProposalActionButtons(
                            proposalId = proposal.id,
                            enabled = !interactionBusy,
                            onOpenAccept = onOpenAccept,
                            onOpenEdit = onOpenEdit,
                            onOpenDismiss = onOpenDismiss
                        )
                }
            } else if (!proposal.approvedTaskId.isNullOrBlank()) {
                Text(
                    text = stringResource(R.string.capture_accept_accepted),
                    fontSize = 15.sp,
                    color = AicaaColors.muted,
                    modifier = Modifier.testTag("capture_proposal_accepted")
                )
            }
        }
    }
}

@Composable
private fun ProposalActionButtons(
    proposalId: String,
    enabled: Boolean,
    onOpenAccept: (String) -> Unit,
    onOpenEdit: (String) -> Unit,
    onOpenDismiss: (String) -> Unit
) {
    AicaaFilledButton(
        onClick = { onOpenAccept(proposalId) },
        enabled = enabled,
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("capture_accept_button")
    ) {
        Text(text = stringResource(R.string.capture_accept))
    }
    AicaaTextButton(
        onClick = { onOpenEdit(proposalId) },
        enabled = enabled,
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("capture_edit_button")
    ) {
        Text(text = stringResource(R.string.capture_edit))
    }
    AicaaDestructiveTextButton(
        onClick = { onOpenDismiss(proposalId) },
        enabled = enabled,
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("capture_dismiss_button")
    ) {
        Text(text = stringResource(R.string.capture_dismiss))
    }
}

@Composable
private fun ProposalEditPane(
    edit: ProposalEditInteraction,
    onCancelEdit: () -> Unit,
    onUpdateEditPoint: (String, String) -> Unit,
    onSaveEdit: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        edit.draftPoints.forEach { point ->
            EditPointRow(
                point = point,
                enabled = !edit.busy,
                onValueChange = { text -> onUpdateEditPoint(point.id, text) }
            )
        }
        if (edit.message != null) {
            Text(
                text = edit.message,
                fontSize = 15.sp,
                color = AicaaColors.warning,
                modifier = Modifier.testTag("capture_edit_message")
            )
        }
        AicaaFilledButton(
            onClick = onSaveEdit,
            enabled = edit.canSave,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_edit_save")
        ) {
            Text(
                text =
                if (edit.saving) {
                    stringResource(R.string.capture_edit_saving)
                } else {
                    stringResource(R.string.capture_edit_save)
                }
            )
        }
        AicaaTextButton(
            onClick = onCancelEdit,
            enabled = !edit.busy,
            modifier = Modifier.testTag("capture_edit_cancel")
        ) {
            Text(text = stringResource(R.string.capture_edit_cancel))
        }
    }
}

@Composable
private fun EditPointRow(
    point: CaptureSummaryPointWire,
    enabled: Boolean,
    onValueChange: (String) -> Unit
) {
    if (point.hasEditableWording) {
        Text(
            text = point.label,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = AicaaColors.ink
        )
        AicaaOutlinedTextField(
            value = point.value.orEmpty(),
            onValueChange = onValueChange,
            enabled = enabled,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_edit_field_${point.id}"),
            keyboardOptions =
            KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences
            )
        )
    } else {
        Text(
            text = "${point.label}: ${summaryPointDetail(point)}",
            fontSize = 15.sp,
            color = AicaaColors.ink,
            modifier = Modifier.testTag("capture_edit_readonly_${point.id}")
        )
    }
}

@Composable
private fun ProposalDismissDialog(
    dismiss: ProposalDismissInteraction,
    onCancelDismiss: () -> Unit,
    onConfirmDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = { if (!dismiss.busy) onCancelDismiss() },
        title = { Text(text = stringResource(R.string.capture_dismiss_confirm_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = stringResource(R.string.capture_dismiss_confirm_body),
                    modifier = Modifier.testTag("capture_dismiss_confirm_body")
                )
                if (dismiss.message != null) {
                    Text(
                        text = dismiss.message,
                        color = AicaaColors.warning,
                        modifier = Modifier.testTag("capture_dismiss_message")
                    )
                }
            }
        },
        confirmButton = {
            AicaaDestructiveTextButton(
                onClick = onConfirmDismiss,
                enabled = !dismiss.busy,
                modifier = Modifier.testTag("capture_dismiss_confirm")
            ) {
                Text(
                    text =
                    if (dismiss.dismissing) {
                        stringResource(R.string.capture_dismissing)
                    } else {
                        stringResource(R.string.capture_dismiss_confirm_action)
                    }
                )
            }
        },
        dismissButton = {
            AicaaTextButton(
                onClick = onCancelDismiss,
                enabled = !dismiss.busy,
                modifier = Modifier.testTag("capture_dismiss_dialog_cancel")
            ) {
                Text(text = stringResource(R.string.capture_dismiss_cancel))
            }
        }
    )
}

@Composable
private fun ProposalAcceptPane(
    accept: ProposalAcceptInteraction,
    onCancelAccept: () -> Unit,
    onSelectOwnerResponsibility: () -> Unit,
    onSelectRecipientResponsibility: (String) -> Unit,
    onConfirmAccept: () -> Unit,
    onRetryAcceptRecipients: () -> Unit,
    onRetryAcceptRecovery: () -> Unit
) {
    val selectionEnabled = !accept.busy && !accept.recoveryReadFailed
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = stringResource(R.string.capture_accept_responsibility_heading),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = AicaaColors.ink,
            modifier = Modifier.testTag("capture_accept_heading")
        )
        ResponsibilityChoiceRow(
            selected = accept.selectedResponsibility is ProposalResponsibility.Owner,
            enabled = selectionEnabled,
            onClick = onSelectOwnerResponsibility,
            testTag = "capture_accept_me",
            title = stringResource(R.string.capture_accept_me)
        )
        if (accept.recipientsLoading) {
            AicaaCircularProgressIndicator(
                modifier = Modifier.testTag("capture_accept_recipients_loading")
            )
        }
        if (accept.recipientsError != null) {
            Text(
                text = accept.recipientsError,
                fontSize = 15.sp,
                color = AicaaColors.destructive,
                modifier = Modifier.testTag("capture_accept_recipients_error")
            )
            AicaaTextButton(
                onClick = onRetryAcceptRecipients,
                enabled = !accept.busy,
                modifier = Modifier.testTag("capture_accept_retry_recipients")
            ) {
                Text(text = stringResource(R.string.retry))
            }
        }
        if (
            !accept.recipientsLoading &&
            accept.recipientsError == null &&
            accept.recipients.isEmpty()
        ) {
            Text(
                text = stringResource(R.string.capture_accept_no_recipients),
                fontSize = 15.sp,
                color = AicaaColors.muted,
                modifier = Modifier.testTag("capture_accept_no_recipients")
            )
        }
        accept.recipients.forEach { recipient ->
            RecipientChoiceRow(
                recipient = recipient,
                selected =
                (accept.selectedResponsibility as? ProposalResponsibility.Recipient)
                    ?.recipientId == recipient.id,
                enabled = selectionEnabled,
                onClick = { onSelectRecipientResponsibility(recipient.id) }
            )
        }
        if (accept.message != null) {
            Text(
                text = accept.message,
                fontSize = 15.sp,
                color = AicaaColors.warning,
                modifier = Modifier.testTag("capture_accept_message")
            )
        }
        if (accept.recoveryReadFailed) {
            AicaaFilledButton(
                onClick = onRetryAcceptRecovery,
                enabled = !accept.busy,
                modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("capture_accept_retry_recovery")
            ) {
                Text(
                    text =
                    if (accept.recovering) {
                        stringResource(R.string.capture_accept_checking)
                    } else {
                        stringResource(R.string.capture_accept_retry_status)
                    }
                )
            }
        } else {
            AicaaFilledButton(
                onClick = onConfirmAccept,
                enabled = accept.canConfirm,
                modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("capture_accept_confirm")
            ) {
                Text(
                    text =
                    when {
                        accept.approving -> stringResource(R.string.capture_accepting)
                        accept.recovering -> stringResource(R.string.capture_accept_checking)
                        else -> stringResource(R.string.capture_accept_confirm)
                    }
                )
            }
        }
        AicaaTextButton(
            onClick = onCancelAccept,
            enabled = !accept.busy,
            modifier = Modifier.testTag("capture_accept_cancel")
        ) {
            Text(text = stringResource(R.string.capture_accept_cancel))
        }
    }
}

@Composable
private fun ResponsibilityChoiceRow(
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    testTag: String,
    title: String,
    subtitle: String? = null
) {
    Row(
        modifier =
        Modifier
            .fillMaxWidth()
            .selectable(
                selected = selected,
                enabled = enabled,
                onClick = onClick,
                role = Role.RadioButton
            )
            .padding(vertical = 6.dp)
            .testTag(testTag),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AicaaRadioButton(
            selected = selected,
            onClick = { if (enabled) onClick() }
        )
        Column(modifier = Modifier.padding(start = 8.dp)) {
            Text(
                text = title,
                color = AicaaColors.ink,
                fontWeight = FontWeight.Medium
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    color = AicaaColors.muted,
                    fontSize = 14.sp
                )
            }
        }
    }
}

@Composable
private fun RecipientChoiceRow(
    recipient: RecipientWire,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    ResponsibilityChoiceRow(
        selected = selected,
        enabled = enabled,
        onClick = onClick,
        testTag = "capture_accept_recipient_${recipient.id}",
        title = recipient.displayName,
        subtitle = recipient.email
    )
}

@Composable
private fun CapturePane(
    modifier: Modifier,
    testTag: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag(testTag),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content
    )
}

@Composable
private fun PaneHeading(text: String) {
    Text(
        text = text,
        style = AicaaTextStyles.pageHeading,
        color = AicaaColors.ink,
        modifier = Modifier.semantics { heading() }
    )
}

@Composable
private fun PaneBody(text: String) {
    Text(
        text = text,
        style = AicaaTextStyles.body,
        color = AicaaColors.muted
    )
}

@Composable
private fun PaneError(message: String?) {
    if (message == null) return
    Text(
        text = message,
        fontSize = 15.sp,
        color = AicaaColors.destructive,
        modifier = Modifier.testTag("capture_error")
    )
}

@Composable
private fun CaptureField(
    value: String,
    onValueChange: (String) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    AicaaOutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = enabled,
        modifier =
        modifier
            .fillMaxWidth()
            .height(160.dp)
            .testTag("capture_field"),
        placeholder = { Text(text = stringResource(R.string.capture_placeholder)) },
        keyboardOptions =
        KeyboardOptions(
            capitalization = KeyboardCapitalization.Sentences
        )
    )
}
