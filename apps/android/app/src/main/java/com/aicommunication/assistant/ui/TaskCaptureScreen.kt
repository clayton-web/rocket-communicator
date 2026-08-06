package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
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
import com.aicommunication.assistant.capture.CapturedTask

@Composable
fun TaskCaptureScreen(
    state: CaptureUiState,
    onDraftChanged: (String) -> Unit,
    onSave: () -> Unit,
    onCaptureAnother: () -> Unit,
    onOpenTask: (CapturedTask) -> Unit,
    onAssign: (CapturedTask) -> Unit,
    onDone: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    when (state) {
        is CaptureUiState.Editing ->
            CaptureEditingPane(
                state = state,
                onDraftChanged = onDraftChanged,
                onSave = onSave,
                onDone = onDone,
                onRetry = onRetry,
                modifier = modifier
            )
        is CaptureUiState.Captured ->
            CaptureSuccessPane(
                task = state.task,
                onCaptureAnother = onCaptureAnother,
                onOpenTask = { onOpenTask(state.task) },
                onAssign = { onAssign(state.task) },
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
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
    }

    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F4))
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("task_capture_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.capture_title),
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF1C1917),
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.capture_subtitle),
            fontSize = 16.sp,
            color = Color(0xFF57534E)
        )
        OutlinedTextField(
            value = state.draft,
            onValueChange = onDraftChanged,
            enabled = !state.submitting,
            modifier =
            Modifier
                .fillMaxWidth()
                .height(160.dp)
                .focusRequester(focusRequester)
                .testTag("capture_field"),
            placeholder = { Text(text = stringResource(R.string.capture_placeholder)) },
            keyboardOptions =
            KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences
            )
        )
        if (state.errorMessage != null) {
            Text(
                text = state.errorMessage,
                fontSize = 15.sp,
                color = Color(0xFFB91C1C),
                modifier = Modifier.testTag("capture_error")
            )
        }
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
        if (state.connectivityIssue) {
            TextButton(
                onClick = onRetry,
                modifier = Modifier.testTag("capture_retry")
            ) {
                Text(text = stringResource(R.string.retry))
            }
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
private fun CaptureSuccessPane(
    task: CapturedTask,
    onCaptureAnother: () -> Unit,
    onOpenTask: () -> Unit,
    onAssign: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F4))
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("capture_success"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.capture_success_title),
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF1C1917),
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.capture_success_body),
            fontSize = 16.sp,
            color = Color(0xFF57534E)
        )
        Text(
            text = task.displayTitle,
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
            color = Color(0xFF0F766E),
            modifier = Modifier.testTag("capture_success_title")
        )
        Spacer(modifier = Modifier.weight(1f))
        Button(
            onClick = onCaptureAnother,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_another_button")
        ) {
            Text(text = stringResource(R.string.capture_another))
        }
        Button(
            onClick = onOpenTask,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("capture_open_task_button")
        ) {
            Text(text = stringResource(R.string.capture_open_task))
        }
        TextButton(
            onClick = onAssign,
            modifier = Modifier.testTag("capture_assign_button")
        ) {
            Text(text = stringResource(R.string.capture_assign))
        }
        TextButton(
            onClick = onDone,
            modifier = Modifier.testTag("capture_done_button")
        ) {
            Text(text = stringResource(R.string.capture_done))
        }
    }
}
