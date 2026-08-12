package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.capture.CaptureUiState
import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.aicommunication.assistant.capture.deriveProposalTitle
import com.aicommunication.assistant.capture.orderedSummaryPoints
import com.aicommunication.assistant.capture.summaryPointDetail

private val SCREEN_BACKGROUND = Color(0xFFF5F5F4)
private val TEXT_PRIMARY = Color(0xFF1C1917)
private val TEXT_SECONDARY = Color(0xFF57534E)
private val TEXT_ACCENT = Color(0xFF0F766E)
private val TEXT_ERROR = Color(0xFFB91C1C)

/**
 * Owner manual capture (S3.3b, D171). Results are read-only: this screen offers no approve,
 * dismiss, edit, merge, or responsibility action on a proposal.
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
        Button(
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
        TextButton(
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
        Button(
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
        TextButton(
            onClick = onDiscard,
            enabled = !state.submitting,
            modifier = Modifier.testTag("capture_discard")
        ) {
            Text(text = stringResource(R.string.capture_discard))
        }
        TextButton(
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
    modifier: Modifier = Modifier
) {
    val empty = state.proposals.isEmpty()
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
            fontSize = 16.sp,
            color = TEXT_SECONDARY,
            modifier =
            Modifier.testTag(if (empty) "capture_result_empty" else "capture_result_summary")
        )
        Text(
            text = stringResource(R.string.capture_result_source, state.capturedText),
            fontSize = 15.sp,
            color = TEXT_SECONDARY,
            modifier = Modifier.testTag("capture_result_source")
        )
        if (empty) {
            Spacer(modifier = Modifier.weight(1f))
            TextButton(
                onClick = onRephrase,
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
                    ProposalCard(proposal = proposal)
                }
            }
        }
        Button(
            onClick = onCaptureAnother,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_another_button")
        ) {
            Text(text = stringResource(R.string.capture_another))
        }
        TextButton(
            onClick = onDone,
            modifier = Modifier.testTag("capture_done_button")
        ) {
            Text(text = stringResource(R.string.capture_done))
        }
    }
}

@Composable
private fun ProposalCard(proposal: TaskSuggestionWire) {
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
                color = TEXT_ACCENT,
                modifier = Modifier.testTag("capture_proposal_title")
            )
            orderedSummaryPoints(proposal).forEach { point ->
                Text(
                    text = "${point.label}: ${summaryPointDetail(point)}",
                    fontSize = 15.sp,
                    color = TEXT_PRIMARY
                )
            }
        }
    }
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
            .background(SCREEN_BACKGROUND)
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
        fontSize = 28.sp,
        fontWeight = FontWeight.SemiBold,
        color = TEXT_PRIMARY,
        modifier = Modifier.semantics { heading() }
    )
}

@Composable
private fun PaneBody(text: String) {
    Text(
        text = text,
        fontSize = 16.sp,
        color = TEXT_SECONDARY
    )
}

@Composable
private fun PaneError(message: String?) {
    if (message == null) return
    Text(
        text = message,
        fontSize = 15.sp,
        color = TEXT_ERROR,
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
    OutlinedTextField(
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
