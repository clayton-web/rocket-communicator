package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskListUiState
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

@Composable
fun TaskListScreen(
    state: TaskListUiState,
    onBack: () -> Unit,
    onOpenTask: (String) -> Unit,
    onCapture: () -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.paper)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("task_list_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.tasks_title),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.tasks_subtitle),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )

        when (state) {
            TaskListUiState.Loading -> {
                Spacer(modifier = Modifier.weight(1f))
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
                Text(
                    text = stringResource(R.string.tasks_loading),
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Spacer(modifier = Modifier.weight(1f))
            }
            is TaskListUiState.Error -> {
                Text(
                    text = state.message,
                    color = AicaaColors.critical,
                    modifier = Modifier.testTag("task_list_error")
                )
                Button(
                    onClick = onRetry,
                    modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("task_list_retry")
                ) {
                    Text(text = stringResource(R.string.retry))
                }
            }
            is TaskListUiState.Ready -> {
                if (state.errorMessage != null) {
                    Text(text = state.errorMessage, color = AicaaColors.critical)
                }
                if (state.tasks.isEmpty()) {
                    Text(
                        text = stringResource(R.string.tasks_empty),
                        color = AicaaColors.muted,
                        modifier = Modifier.testTag("task_list_empty")
                    )
                    Button(
                        onClick = onCapture,
                        modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("task_list_capture")
                    ) {
                        Text(text = stringResource(R.string.capture_entry))
                    }
                } else {
                    LazyColumn(
                        modifier =
                        Modifier
                            .weight(1f)
                            .testTag("task_list_items"),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        items(state.tasks, key = { it.id }) { task ->
                            TaskListRow(task = task, onClick = { onOpenTask(task.id) })
                            HorizontalDivider(color = Color(0xFFE7E5E4))
                        }
                        if (state.nextCursor != null) {
                            item {
                                TextButton(
                                    onClick = onLoadMore,
                                    enabled = !state.loadingMore,
                                    modifier = Modifier.testTag("task_list_load_more")
                                ) {
                                    Text(text = stringResource(R.string.tasks_load_more))
                                }
                            }
                        }
                    }
                }
                TextButton(onClick = onRefresh, enabled = !state.refreshing) {
                    Text(text = stringResource(R.string.tasks_refresh))
                }
            }
        }

        TextButton(onClick = onBack, modifier = Modifier.testTag("task_list_back")) {
            Text(text = stringResource(R.string.tasks_back))
        }
    }
}

@Composable
private fun TaskListRow(task: OwnerTask, onClick: () -> Unit) {
    Column(
        modifier =
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp)
            .testTag("task_row_${task.id}"),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = task.displayTitle,
            fontSize = 17.sp,
            fontWeight = FontWeight.Medium,
            color = AicaaColors.ink
        )
        Text(
            text = "${task.statusLabel} · ${task.ownershipLabel}",
            fontSize = 14.sp,
            color = AicaaColors.muted
        )
    }
}
