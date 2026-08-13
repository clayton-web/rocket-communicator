package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.tasks.DueLocalDates
import com.aicommunication.assistant.tasks.TaskDetailUiState
import com.aicommunication.assistant.ui.theme.AicaaCircularProgressIndicator
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaDestructiveTextButton
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaOutlinedTextField
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

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
    onSetDueDate: (String) -> Unit,
    onClearDueDate: () -> Unit,
    onSetAdvanceEnabled: (Boolean) -> Unit,
    onNoteChanged: (String) -> Unit,
    onSaveNote: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("task_detail_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        when (state) {
            TaskDetailUiState.Loading -> {
                Spacer(modifier = Modifier.weight(1f))
                AicaaCircularProgressIndicator(
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Spacer(modifier = Modifier.weight(1f))
            }
            is TaskDetailUiState.Error -> {
                Text(
                    text = state.message,
                    color = AicaaColors.destructive,
                    modifier = Modifier.testTag("task_detail_error")
                )
                AicaaFilledButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
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
                        style = AicaaTextStyles.pageHeading,
                        color = AicaaColors.ink,
                        modifier =
                        Modifier
                            .semantics { heading() }
                            .testTag("task_detail_title")
                    )
                    Text(
                        text = state.task.statusLabel,
                        style = AicaaTextStyles.body,
                        color = AicaaColors.muted,
                        modifier = Modifier.testTag("task_detail_status")
                    )
                    Text(
                        text = state.task.ownershipLabel,
                        fontSize = 15.sp,
                        color = AicaaColors.muted,
                        modifier = Modifier.testTag("task_detail_ownership")
                    )
                    TaskSchedulingSection(
                        state = state,
                        onSetDueDate = onSetDueDate,
                        onClearDueDate = onClearDueDate,
                        onSetAdvanceEnabled = onSetAdvanceEnabled
                    )
                    if (state.banner != null) {
                        Text(text = state.banner, color = AicaaColors.info)
                    }
                    if (state.errorMessage != null) {
                        Text(
                            text = state.errorMessage,
                            color = AicaaColors.destructive,
                            modifier = Modifier.testTag("task_detail_mutation_error")
                        )
                    }

                    if (!state.task.isTerminal) {
                        when (state.task.status) {
                            "open" ->
                                AicaaFilledButton(
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
                                AicaaFilledButton(
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
                                AicaaFilledButton(
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
                        AicaaTextButton(
                            onClick = onComplete,
                            enabled = !state.mutating,
                            modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("task_action_complete")
                        ) {
                            Text(text = stringResource(R.string.task_action_complete))
                        }
                        AicaaDestructiveTextButton(
                            onClick = onDismiss,
                            enabled = !state.mutating,
                            modifier = Modifier.testTag("task_action_dismiss")
                        ) {
                            Text(text = stringResource(R.string.task_action_dismiss))
                        }
                        if (state.task.canAssign) {
                            AicaaTextButton(
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
                        color = AicaaColors.ink,
                        fontWeight = FontWeight.Medium
                    )
                    state.task.noteBodies.forEach { note ->
                        Text(text = note, color = AicaaColors.muted)
                    }
                    if (!state.task.isTerminal) {
                        AicaaOutlinedTextField(
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
                        AicaaTextButton(
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

        AicaaTextButton(onClick = onBack, modifier = Modifier.testTag("task_detail_back")) {
            Text(text = stringResource(R.string.tasks_back))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskSchedulingSection(
    state: TaskDetailUiState.Ready,
    onSetDueDate: (String) -> Unit,
    onClearDueDate: () -> Unit,
    onSetAdvanceEnabled: (Boolean) -> Unit
) {
    var showDatePicker by remember { mutableStateOf(false) }
    val dueLocalDate = state.task.dueLocalDate
    val urgencyLabel = state.task.urgencyLabel
    val urgencyColor =
        when (state.task.derivedUrgency) {
            "overdue" -> AicaaColors.destructive
            "due_soon" -> AicaaColors.warning
            else -> AicaaColors.muted
        }

    Column(
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("task_detail_scheduling_section"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = stringResource(R.string.task_detail_scheduling_heading),
            style = AicaaTextStyles.sectionTitle,
            color = AicaaColors.ink,
            modifier =
            Modifier
                .semantics { heading() }
                .testTag("task_detail_scheduling_heading")
        )
        Column(
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("task_detail_due_section"),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            SchedulingFactRow(
                icon = Icons.Filled.DateRange,
                title = stringResource(R.string.task_detail_due_heading),
                value =
                if (dueLocalDate.isNullOrBlank()) {
                    stringResource(R.string.task_detail_due_empty)
                } else {
                    DueLocalDates.formatWeekday(dueLocalDate)
                },
                supporting = urgencyLabel,
                supportingColor = urgencyColor,
                valueTestTag =
                if (dueLocalDate.isNullOrBlank()) {
                    "task_detail_due_empty"
                } else {
                    "task_detail_due_date"
                },
                supportingTestTag = "task_detail_urgency",
                modifier = Modifier.testTag("task_detail_due_heading")
            )
            if (!state.task.isTerminal) {
                AicaaTextButton(
                    onClick = { showDatePicker = true },
                    enabled = state.canEditDueDate,
                    modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("task_detail_set_due_date")
                ) {
                    Text(
                        text =
                        stringResource(
                            if (dueLocalDate.isNullOrBlank()) {
                                R.string.task_detail_set_due_date
                            } else {
                                R.string.task_detail_change_due_date
                            }
                        )
                    )
                }
                if (!dueLocalDate.isNullOrBlank()) {
                    AicaaDestructiveTextButton(
                        onClick = onClearDueDate,
                        enabled = state.canEditDueDate,
                        modifier = Modifier.testTag("task_detail_clear_due_date")
                    ) {
                        Text(text = stringResource(R.string.task_detail_clear_due_date))
                    }
                }
            }
        }
        HorizontalDivider(color = AicaaColors.structuralBorder)
        AutomaticReminderRow(state = state, onSetAdvanceEnabled = onSetAdvanceEnabled)
    }

    if (showDatePicker) {
        val pickerState =
            rememberDatePickerState(
                initialSelectedDateMillis = DueLocalDates.toUtcEpochMillis(dueLocalDate.orEmpty())
            )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                AicaaTextButton(
                    onClick = {
                        val millis = pickerState.selectedDateMillis
                        val selected = millis?.let(DueLocalDates::fromUtcEpochMillis)
                        showDatePicker = false
                        if (selected != null) {
                            onSetDueDate(selected)
                        }
                    },
                    modifier = Modifier.testTag("task_detail_date_picker_confirm")
                ) {
                    Text(text = stringResource(R.string.task_detail_due_date_confirm))
                }
            },
            dismissButton = {
                AicaaTextButton(
                    onClick = { showDatePicker = false },
                    modifier = Modifier.testTag("task_detail_date_picker_cancel")
                ) {
                    Text(text = stringResource(R.string.task_detail_due_date_cancel))
                }
            },
            modifier = Modifier.testTag("task_detail_date_picker")
        ) {
            DatePicker(
                state = pickerState,
                showModeToggle = false,
                title = {
                    Text(text = stringResource(R.string.task_detail_due_heading))
                }
            )
        }
    }
}

@Composable
private fun AutomaticReminderRow(
    state: TaskDetailUiState.Ready,
    onSetAdvanceEnabled: (Boolean) -> Unit
) {
    val occurrenceLocalDate = state.automaticAdvanceLocalDate
    val windowElapsed =
        state.automaticReminderOn && state.advanceDisposition == "skipped_window_elapsed"
    val value: String
    val supporting: String?
    val valueTestTag: String
    when {
        !state.hasDeadline -> {
            value = stringResource(R.string.task_detail_advance_unavailable)
            supporting = null
            valueTestTag = "task_detail_advance_unavailable"
        }
        windowElapsed -> {
            value = stringResource(R.string.task_detail_advance_window_elapsed)
            supporting = null
            valueTestTag = "task_detail_advance_window_elapsed"
        }
        occurrenceLocalDate != null -> {
            value =
                stringResource(
                    R.string.task_detail_advance_occurrence,
                    DueLocalDates.formatWeekday(occurrenceLocalDate),
                    stringResource(R.string.task_detail_advance_time)
                )
            supporting = stringResource(R.string.task_detail_advance_caption)
            valueTestTag = "task_detail_advance_occurrence"
        }
        else -> {
            value = stringResource(R.string.task_detail_advance_off)
            supporting = stringResource(R.string.task_detail_advance_off_caption)
            valueTestTag = "task_detail_advance_off"
        }
    }
    Column(
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("task_detail_reminders_group"),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        SchedulingFactRow(
            icon = Icons.Filled.Notifications,
            title = stringResource(R.string.task_detail_advance_heading),
            value = value,
            supporting = supporting,
            valueTestTag = valueTestTag,
            trailing = {
                Switch(
                    checked = state.automaticReminderOn,
                    onCheckedChange = onSetAdvanceEnabled,
                    enabled = state.canEditAdvanceReminder,
                    modifier = Modifier.testTag("task_detail_advance_toggle")
                )
            },
            modifier = Modifier.testTag("task_detail_advance_section")
        )
    }
}

@Composable
private fun SchedulingFactRow(
    icon: ImageVector,
    title: String,
    value: String,
    supporting: String? = null,
    supportingColor: Color = AicaaColors.muted,
    valueTestTag: String,
    supportingTestTag: String? = null,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Row(
        modifier =
        modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier.clickable(onClick = onClick)
                } else {
                    Modifier
                }
            )
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = AicaaColors.muted,
            modifier =
            Modifier
                .padding(top = 2.dp)
                .size(22.dp)
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = title,
                color = AicaaColors.ink,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = value,
                color = AicaaColors.ink,
                modifier = Modifier.testTag(valueTestTag)
            )
            if (supporting != null) {
                Text(
                    text = supporting,
                    color = supportingColor,
                    modifier =
                    if (supportingTestTag != null) {
                        Modifier.testTag(supportingTestTag)
                    } else {
                        Modifier
                    }
                )
            }
        }
        if (trailing != null) {
            trailing()
        }
    }
}
