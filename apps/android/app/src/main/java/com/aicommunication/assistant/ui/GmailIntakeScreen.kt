package com.aicommunication.assistant.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aicommunication.assistant.R
import com.aicommunication.assistant.tasks.GmailIntakeItemWire
import com.aicommunication.assistant.tasks.GmailIntakeUiState
import com.aicommunication.assistant.ui.theme.AicaaCircularProgressIndicator
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles

@Composable
fun GmailIntakeScreen(
    state: GmailIntakeUiState,
    onBack: () -> Unit,
    onSelect: (String) -> Unit,
    onReview: () -> Unit,
    onExclude: () -> Unit,
    onUndoExclude: () -> Unit,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("gmail_intake_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.gmail_intake_title),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.gmail_intake_subtitle),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )

        when (state) {
            GmailIntakeUiState.Loading -> {
                Spacer(modifier = Modifier.weight(1f))
                AicaaCircularProgressIndicator(
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Text(
                    text = stringResource(R.string.gmail_intake_loading),
                    color = AicaaColors.muted,
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Spacer(modifier = Modifier.weight(1f))
            }
            is GmailIntakeUiState.Error -> {
                Text(
                    text = state.message,
                    color = AicaaColors.destructive,
                    modifier = Modifier.testTag("gmail_intake_error")
                )
                AicaaFilledButton(
                    onClick = onRetry,
                    modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("gmail_intake_retry")
                ) {
                    Text(text = stringResource(R.string.retry))
                }
            }
            is GmailIntakeUiState.Ready ->
                ReadyIntakeContent(
                    state = state,
                    onSelect = onSelect,
                    onReview = onReview,
                    onExclude = onExclude,
                    onUndoExclude = onUndoExclude,
                    onRefresh = onRefresh,
                    onLoadMore = onLoadMore
                )
        }

        AicaaTextButton(onClick = onBack, modifier = Modifier.testTag("gmail_intake_back")) {
            Text(text = stringResource(R.string.gmail_intake_back))
        }
    }
}

@Composable
private fun ColumnScope.ReadyIntakeContent(
    state: GmailIntakeUiState.Ready,
    onSelect: (String) -> Unit,
    onReview: () -> Unit,
    onExclude: () -> Unit,
    onUndoExclude: () -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit
) {
    if (state.errorMessage != null) {
        Text(
            text = state.errorMessage,
            color = AicaaColors.destructive,
            modifier = Modifier.testTag("gmail_intake_inline_error")
        )
    }
    if (state.items.isEmpty()) {
        Text(
            text = stringResource(R.string.gmail_intake_empty),
            color = AicaaColors.muted,
            modifier = Modifier.testTag("gmail_intake_empty")
        )
        if (state.nextCursor != null) {
            AicaaTextButton(
                onClick = onLoadMore,
                enabled = !state.loadingMore && !state.reviewing && !state.excluding,
                modifier = Modifier.testTag("gmail_intake_load_more")
            ) {
                Text(text = stringResource(R.string.gmail_intake_load_more))
            }
        }
    } else {
        LazyColumn(
            modifier =
            Modifier
                .weight(1f)
                .testTag("gmail_intake_items"),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            items(state.items, key = { it.id }) { item ->
                GmailIntakeRow(
                    item = item,
                    selected = item.id == state.selectedId,
                    enabled = !state.reviewing && !state.excluding,
                    onClick = { onSelect(item.id) }
                )
                HorizontalDivider()
            }
            if (state.nextCursor != null) {
                item {
                    AicaaTextButton(
                        onClick = onLoadMore,
                        enabled = !state.loadingMore && !state.reviewing && !state.excluding,
                        modifier = Modifier.testTag("gmail_intake_load_more")
                    ) {
                        Text(text = stringResource(R.string.gmail_intake_load_more))
                    }
                }
            }
        }
    }
    if (state.reviewError != null) {
        Text(
            text = state.reviewError,
            color = AicaaColors.destructive,
            modifier = Modifier.testTag("gmail_review_error")
        )
    }
    AicaaFilledButton(
        onClick = onReview,
        enabled = state.canReview || state.canRetryReview,
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("gmail_review_button")
    ) {
        Text(
            text =
            if (state.reviewing) {
                stringResource(R.string.gmail_reviewing)
            } else if (state.canRetryReview) {
                stringResource(R.string.retry)
            } else {
                stringResource(R.string.gmail_review_action)
            }
        )
    }
    if (state.excludeError != null) {
        Text(
            text = state.excludeError,
            color = AicaaColors.destructive,
            modifier = Modifier.testTag("gmail_exclude_error")
        )
    }
    if (state.excludeSuccessMessage != null) {
        Text(
            text = state.excludeSuccessMessage,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("gmail_exclude_success")
        )
    }
    AicaaTextButton(
        onClick = onExclude,
        enabled = state.canExclude,
        modifier =
        Modifier
            .fillMaxWidth()
            .testTag("gmail_exclude_button")
    ) {
        Text(
            text =
            if (state.excluding && state.undoExclusionId == null) {
                stringResource(R.string.gmail_excluding_sender)
            } else {
                stringResource(R.string.gmail_exclude_sender)
            }
        )
    }
    if (state.undoExclusionId != null) {
        AicaaTextButton(
            onClick = onUndoExclude,
            enabled = state.canUndoExclude,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("gmail_exclude_undo")
        ) {
            Text(text = stringResource(R.string.gmail_exclude_undo))
        }
    }
    AicaaTextButton(
        onClick = onRefresh,
        enabled = !state.refreshing && !state.reviewing && !state.excluding
    ) {
        Text(text = stringResource(R.string.gmail_intake_refresh))
    }
}

@Composable
private fun GmailIntakeRow(
    item: GmailIntakeItemWire,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val title =
        item.subject?.takeIf { it.isNotBlank() }
            ?: stringResource(R.string.gmail_intake_no_subject)
    Column(
        modifier =
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 12.dp)
            .testTag("gmail_intake_item_${item.id}"),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = title,
            fontSize = 18.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            color = if (selected) AicaaColors.info else AicaaColors.ink,
            modifier = Modifier.testTag("gmail_intake_item_title")
        )
        Text(
            text = item.fromAddress,
            fontSize = 15.sp,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("gmail_intake_item_from")
        )
        val snippet = item.snippet?.takeIf { it.isNotBlank() }
        if (snippet != null) {
            Text(
                text = snippet,
                fontSize = 15.sp,
                color = AicaaColors.muted,
                modifier = Modifier.testTag("gmail_intake_item_snippet")
            )
        }
        Text(
            text = item.receivedAt.take(10),
            fontSize = 14.sp,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("gmail_intake_item_received")
        )
    }
}
