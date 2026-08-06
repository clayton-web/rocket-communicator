package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
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
import com.aicommunication.assistant.tasks.TaskDetailUiState

@Composable
fun TaskDetailScreen(
    state: TaskDetailUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onStart: () -> Unit,
    onWaiting: () -> Unit,
    onResume: () -> Unit,
    onComplete: () -> Unit,
    onDismiss: () -> Unit,
    onAssign: () -> Unit,
    onNoteChanged: (String) -> Unit,
    onSaveNote: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F4))
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("task_detail_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        when (state) {
            TaskDetailUiState.Loading -> {
                Spacer(modifier = Modifier.weight(1f))
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                Spacer(modifier = Modifier.weight(1f))
            }
            is TaskDetailUiState.Error -> {
                Text(
                    text = state.message,
                    color = Color(0xFFB91C1C),
                    modifier = Modifier.testTag("task_detail_error")
                )
                Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
                    Text(text = stringResource(R.string.retry))
                }
            }
            is TaskDetailUiState.Ready -> {
                Column(
                    modifier =
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = true)
                        .verticalScroll(rememberScrollState())
                        .testTag("task_detail_content"),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = state.task.displayTitle,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF1C1917),
                        modifier =
                        Modifier
                            .semantics { heading() }
                            .testTag("task_detail_title")
                    )
                    Text(
                        text = state.task.statusLabel,
                        fontSize = 16.sp,
                        color = Color(0xFF0F766E),
                        modifier = Modifier.testTag("task_detail_status")
                    )
                    Text(
                        text = state.task.ownershipLabel,
                        fontSize = 15.sp,
                        color = Color(0xFF57534E),
                        modifier = Modifier.testTag("task_detail_ownership")
                    )
                    if (state.banner != null) {
                        Text(text = state.banner, color = Color(0xFF0F766E))
                    }
                    if (state.errorMessage != null) {
                        Text(
                            text = state.errorMessage,
                            color = Color(0xFFB91C1C),
                            modifier = Modifier.testTag("task_detail_mutation_error")
                        )
                    }

                    if (!state.task.isTerminal) {
                        when (state.task.status) {
                            "open" ->
                                Button(
                                    onClick = onStart,
                                    enabled = !state.mutating,
                                    modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .testTag("task_action_start")
                                ) {
                                    Text(text = stringResource(R.string.task_action_start))
                                }
                            "in_progress" ->
                                Button(
                                    onClick = onWaiting,
                                    enabled = !state.mutating,
                                    modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .testTag("task_action_waiting")
                                ) {
                                    Text(text = stringResource(R.string.task_action_waiting))
                                }
                            "waiting" ->
                                Button(
                                    onClick = onResume,
                                    enabled = !state.mutating,
                                    modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .testTag("task_action_resume")
                                ) {
                                    Text(text = stringResource(R.string.task_action_resume))
                                }
                        }
                        Button(
                            onClick = onComplete,
                            enabled = !state.mutating,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("task_action_complete")
                        ) {
                            Text(text = stringResource(R.string.task_action_complete))
                        }
                        TextButton(
                            onClick = onDismiss,
                            enabled = !state.mutating,
                            modifier = Modifier.testTag("task_action_dismiss")
                        ) {
                            Text(text = stringResource(R.string.task_action_dismiss))
                        }
                        if (state.task.canAssign) {
                            Button(
                                onClick = onAssign,
                                enabled = !state.mutating,
                                modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .testTag("task_action_assign")
                            ) {
                                Text(text = stringResource(R.string.task_action_assign))
                            }
                        }
                    }

                    Text(
                        text = stringResource(R.string.task_notes_heading),
                        fontWeight = FontWeight.Medium
                    )
                    state.task.noteBodies.forEach { note ->
                        Text(text = note, color = Color(0xFF44403C))
                    }
                    if (!state.task.isTerminal) {
                        OutlinedTextField(
                            value = state.noteDraft,
                            onValueChange = onNoteChanged,
                            enabled = !state.mutating,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .height(100.dp)
                                .testTag("task_note_field"),
                            placeholder = { Text(text = stringResource(R.string.task_note_hint)) }
                        )
                        TextButton(
                            onClick = onSaveNote,
                            enabled = !state.mutating && state.noteDraft.trim().isNotEmpty(),
                            modifier = Modifier.testTag("task_note_save")
                        ) {
                            Text(text = stringResource(R.string.task_note_save))
                        }
                    }
                }
            }
        }

        TextButton(onClick = onBack, modifier = Modifier.testTag("task_detail_back")) {
            Text(text = stringResource(R.string.tasks_back))
        }
    }
}
