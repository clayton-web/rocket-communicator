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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.aicommunication.assistant.R
import com.aicommunication.assistant.messages.MessagesFilteredItem
import com.aicommunication.assistant.messages.MessagesIneligibilityReason
import com.aicommunication.assistant.messages.MessagesIntakeUiState
import com.aicommunication.assistant.messages.MessagesNotificationShape
import com.aicommunication.assistant.messages.MessagesReviewItem
import com.aicommunication.assistant.ui.theme.AicaaCircularProgressIndicator
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaFilledButton
import com.aicommunication.assistant.ui.theme.AicaaTextButton
import com.aicommunication.assistant.ui.theme.AicaaTextStyles
import java.time.Instant
import java.time.ZoneId

@Composable
fun MessagesIntakeScreen(
    state: MessagesIntakeUiState,
    onBack: () -> Unit,
    onOpenNotificationAccess: () -> Unit,
    onRefreshAccess: () -> Unit,
    onSelect: (String) -> Unit,
    onReview: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = context as? LifecycleOwner
    DisposableEffect(lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    onRefreshAccess()
                }
            }
        lifecycleOwner?.lifecycle?.addObserver(observer)
        onDispose { lifecycleOwner?.lifecycle?.removeObserver(observer) }
    }

    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(AicaaColors.background)
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("messages_intake_screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = stringResource(R.string.messages_intake_title),
            style = AicaaTextStyles.pageHeading,
            color = AicaaColors.ink,
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = stringResource(R.string.messages_intake_subtitle),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )

        when (state) {
            MessagesIntakeUiState.CheckingAccess -> {
                Spacer(modifier = Modifier.weight(1f))
                AicaaCircularProgressIndicator(
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Text(
                    text = stringResource(R.string.messages_intake_checking_access),
                    color = AicaaColors.muted,
                    modifier = Modifier.align(Alignment.CenterHorizontally)
                )
                Spacer(modifier = Modifier.weight(1f))
            }
            MessagesIntakeUiState.AccessDisabled -> {
                Text(
                    text = stringResource(R.string.messages_intake_access_body),
                    color = AicaaColors.ink,
                    modifier = Modifier.testTag("messages_intake_access_needed")
                )
                AicaaFilledButton(
                    onClick = onOpenNotificationAccess,
                    modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("messages_intake_open_access")
                ) {
                    Text(text = stringResource(R.string.messages_intake_open_access))
                }
            }
            is MessagesIntakeUiState.Ready ->
                ReadyMessagesContent(
                    state = state,
                    onSelect = onSelect,
                    onReview = onReview
                )
        }

        AicaaTextButton(onClick = onBack, modifier = Modifier.testTag("messages_intake_back")) {
            Text(text = stringResource(R.string.messages_intake_back))
        }
    }
}

@Composable
private fun ColumnScope.ReadyMessagesContent(
    state: MessagesIntakeUiState.Ready,
    onSelect: (String) -> Unit,
    onReview: () -> Unit
) {
    if (state.listenerError) {
        Text(
            text = stringResource(R.string.messages_intake_listener_error),
            color = AicaaColors.destructive,
            modifier = Modifier.testTag("messages_intake_listener_error")
        )
    }
    if (state.eligible.isEmpty()) {
        Text(
            text = stringResource(R.string.messages_intake_empty),
            color = AicaaColors.muted,
            modifier = Modifier.testTag("messages_intake_empty")
        )
    } else {
        LazyColumn(
            modifier =
            Modifier
                .weight(1f)
                .testTag("messages_intake_items"),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            items(state.eligible, key = { it.id }) { item ->
                MessagesIntakeRow(
                    item = item,
                    selected = item.id == state.selectedId,
                    enabled = !state.reviewing,
                    onClick = { onSelect(item.id) }
                )
                HorizontalDivider()
            }
        }
    }
    if (state.reviewError != null) {
        Text(
            text = state.reviewError,
            color = AicaaColors.destructive,
            modifier = Modifier.testTag("messages_review_error")
        )
    }
    if (state.eligible.isNotEmpty() || state.canRetryReview) {
        AicaaFilledButton(
            onClick = onReview,
            enabled = state.canReview || state.canRetryReview,
            modifier =
            Modifier
                .fillMaxWidth()
                .testTag("messages_review_button")
        ) {
            Text(
                text =
                if (state.reviewing) {
                    stringResource(R.string.messages_reviewing)
                } else if (state.canRetryReview) {
                    stringResource(R.string.retry)
                } else {
                    stringResource(R.string.messages_review_action)
                }
            )
        }
    }
    if (state.filtered.isNotEmpty()) {
        Text(
            text = filteredSummary(state.filtered),
            color = AicaaColors.muted,
            modifier = Modifier.testTag("messages_intake_filtered")
        )
    }
    if (state.shapes.isNotEmpty()) {
        DebugShapeSection(shapes = state.shapes)
    }
}

@Composable
private fun MessagesIntakeRow(
    item: MessagesReviewItem,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Column(
        modifier =
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 12.dp)
            .testTag("messages_intake_item_${item.id}"),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = item.senderLabel,
            fontSize = 18.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            color = if (selected) AicaaColors.info else AicaaColors.ink,
            modifier = Modifier.testTag("messages_intake_item_sender")
        )
        Text(
            text = item.text,
            fontSize = 15.sp,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("messages_intake_item_text")
        )
        Text(
            text =
            Instant.ofEpochMilli(item.postedAtMs)
                .atZone(ZoneId.systemDefault())
                .toLocalDate()
                .toString(),
            fontSize = 14.sp,
            color = AicaaColors.muted,
            modifier = Modifier.testTag("messages_intake_item_posted")
        )
    }
}

@Composable
private fun DebugShapeSection(shapes: List<MessagesNotificationShape>) {
    Column(
        modifier = Modifier.testTag("messages_intake_debug_shapes"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = stringResource(R.string.messages_intake_debug_title),
            style = AicaaTextStyles.sectionTitle,
            color = AicaaColors.ink
        )
        Text(
            text = stringResource(R.string.messages_intake_debug_body),
            style = AicaaTextStyles.body,
            color = AicaaColors.muted
        )
        shapes.forEachIndexed { index, shape ->
            Text(
                text = shape.debugLine(),
                fontSize = 13.sp,
                color = AicaaColors.muted,
                modifier = Modifier.testTag("messages_intake_debug_shape_$index")
            )
        }
    }
}

@Composable
private fun filteredSummary(filtered: List<MessagesFilteredItem>): String {
    val counts = filtered.groupingBy { it.reason }.eachCount()
    val parts =
        counts.entries.sortedBy { it.key.name }.map { (reason, count) ->
            "$count ${reasonLabel(reason)}"
        }
    return stringResource(R.string.messages_intake_filtered, parts.joinToString(", "))
}

@Composable
private fun reasonLabel(reason: MessagesIneligibilityReason): String {
    val resId =
        when (reason) {
            MessagesIneligibilityReason.EMPTY_TEXT ->
                R.string.messages_reason_empty_text
            MessagesIneligibilityReason.MEDIA_ONLY ->
                R.string.messages_reason_media_only
            MessagesIneligibilityReason.GROUP_OR_AMBIGUOUS ->
                R.string.messages_reason_group
            MessagesIneligibilityReason.SUMMARY_OR_GROUPED ->
                R.string.messages_reason_summary
            MessagesIneligibilityReason.UNSUPPORTED_SHAPE ->
                R.string.messages_reason_unsupported
            MessagesIneligibilityReason.MISSING_SENDER ->
                R.string.messages_reason_missing_sender
            MessagesIneligibilityReason.OTP_OR_FINANCIAL ->
                R.string.messages_reason_sensitive
            MessagesIneligibilityReason.PACKAGE_NOT_ALLOWLISTED ->
                R.string.messages_reason_unsupported
        }
    return stringResource(resId)
}
