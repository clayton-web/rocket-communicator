package com.aicommunication.assistant.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.aicommunication.assistant.capture.TaskCaptureViewModel
import com.aicommunication.assistant.contracts.models.Session
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.tasks.TaskDetailViewModel
import com.aicommunication.assistant.tasks.TaskHandoffViewModel
import com.aicommunication.assistant.tasks.TaskListViewModel

private enum class AuthenticatedDestination {
    Shell,
    Capture,
    TaskList,
    TaskDetail,
    Assign
}

@Composable
fun AuthenticatedOwnerFlow(
    session: Session,
    signingOut: Boolean,
    onSignOut: () -> Unit,
    apiConfig: ApiConfig,
    captureViewModel: TaskCaptureViewModel,
    taskListViewModel: TaskListViewModel,
    taskDetailViewModel: TaskDetailViewModel,
    taskHandoffViewModel: TaskHandoffViewModel,
    modifier: Modifier = Modifier
) {
    var destination by rememberSaveable { mutableStateOf(AuthenticatedDestination.Shell) }
    var activeTaskId by rememberSaveable { mutableStateOf<String?>(null) }
    var detailReturn by rememberSaveable { mutableStateOf(AuthenticatedDestination.TaskList.name) }
    var assignReturn by rememberSaveable {
        mutableStateOf(
            AuthenticatedDestination.TaskDetail.name
        )
    }
    val context = LocalContext.current

    val captureState by captureViewModel.uiState.collectAsState()
    val openApprovedTaskId by captureViewModel.openApprovedTaskId.collectAsState()
    val listState by taskListViewModel.uiState.collectAsState()
    val detailState by taskDetailViewModel.uiState.collectAsState()
    val handoffState by taskHandoffViewModel.uiState.collectAsState()

    LaunchedEffect(openApprovedTaskId) {
        val taskId = openApprovedTaskId ?: return@LaunchedEffect
        activeTaskId = taskId
        detailReturn = AuthenticatedDestination.Capture.name
        destination = AuthenticatedDestination.TaskDetail
        captureViewModel.consumeOpenApprovedTask()
    }

    LaunchedEffect(destination, activeTaskId) {
        when (destination) {
            // Surfaces an unresolved capture after process death; never resends it.
            AuthenticatedDestination.Capture -> captureViewModel.restorePending()
            AuthenticatedDestination.TaskList -> taskListViewModel.load()
            AuthenticatedDestination.TaskDetail ->
                activeTaskId?.let { taskDetailViewModel.load(it) }
            AuthenticatedDestination.Assign ->
                activeTaskId?.let { taskHandoffViewModel.load(it) }
            else -> Unit
        }
    }

    when (destination) {
        AuthenticatedDestination.Shell ->
            AuthenticatedShellScreen(
                session = session,
                signingOut = signingOut,
                onCapture = { destination = AuthenticatedDestination.Capture },
                onTasks = { destination = AuthenticatedDestination.TaskList },
                onSignOut = onSignOut,
                modifier = modifier
            )
        // Manual capture proposes and creates no Task. Accept may later open Task detail.
        // Edit and Dismiss stay on this capture result.
        AuthenticatedDestination.Capture ->
            TaskCaptureScreen(
                state = captureState,
                onDraftChanged = captureViewModel::onDraftChanged,
                onSave = captureViewModel::save,
                onRetry = captureViewModel::retry,
                onDiscard = captureViewModel::discard,
                onRephrase = captureViewModel::rephrase,
                onCaptureAnother = captureViewModel::captureAnother,
                onDone = {
                    captureViewModel.onLeaveCapture()
                    destination = AuthenticatedDestination.Shell
                },
                onOpenAccept = captureViewModel::openAccept,
                onCancelAccept = captureViewModel::cancelAccept,
                onSelectOwnerResponsibility = captureViewModel::selectOwnerResponsibility,
                onSelectRecipientResponsibility = captureViewModel::selectRecipientResponsibility,
                onConfirmAccept = captureViewModel::confirmAccept,
                onRetryAcceptRecipients = captureViewModel::retryAcceptRecipients,
                onRetryAcceptRecovery = captureViewModel::retryAcceptRecovery,
                onOpenEdit = captureViewModel::openEdit,
                onCancelEdit = captureViewModel::cancelEdit,
                onUpdateEditPoint = captureViewModel::updateEditPoint,
                onSaveEdit = captureViewModel::saveEdit,
                onOpenDismiss = captureViewModel::openDismiss,
                onCancelDismiss = captureViewModel::cancelDismiss,
                onConfirmDismiss = captureViewModel::confirmDismiss,
                modifier = modifier
            )
        AuthenticatedDestination.TaskList ->
            TaskListScreen(
                state = listState,
                onBack = { destination = AuthenticatedDestination.Shell },
                onOpenTask = { id ->
                    activeTaskId = id
                    detailReturn = AuthenticatedDestination.TaskList.name
                    destination = AuthenticatedDestination.TaskDetail
                },
                onCapture = { destination = AuthenticatedDestination.Capture },
                onRetry = taskListViewModel::load,
                onRefresh = taskListViewModel::refresh,
                onLoadMore = taskListViewModel::loadMore,
                modifier = modifier
            )
        AuthenticatedDestination.TaskDetail ->
            TaskDetailScreen(
                state = detailState,
                onBack = {
                    destination =
                        runCatching { AuthenticatedDestination.valueOf(detailReturn) }
                            .getOrDefault(AuthenticatedDestination.Shell)
                },
                onRetry = { activeTaskId?.let(taskDetailViewModel::load) },
                onStart = taskDetailViewModel::start,
                onWaiting = taskDetailViewModel::waiting,
                onResume = taskDetailViewModel::resume,
                onComplete = taskDetailViewModel::complete,
                onDismiss = taskDetailViewModel::dismiss,
                onAssign = {
                    assignReturn = AuthenticatedDestination.TaskDetail.name
                    destination = AuthenticatedDestination.Assign
                },
                onNoteChanged = taskDetailViewModel::onNoteDraftChanged,
                onSaveNote = taskDetailViewModel::addNote,
                modifier = modifier
            )
        AuthenticatedDestination.Assign ->
            AssignScreen(
                state = handoffState,
                onBack = {
                    destination =
                        runCatching { AuthenticatedDestination.valueOf(assignReturn) }
                            .getOrDefault(AuthenticatedDestination.TaskDetail)
                },
                onRetryLoad = { activeTaskId?.let(taskHandoffViewModel::load) },
                onSelectRecipient = taskHandoffViewModel::selectRecipient,
                onOpenConfirm = taskHandoffViewModel::openConfirm,
                onCloseConfirm = taskHandoffViewModel::closeConfirm,
                onConfirm = taskHandoffViewModel::confirmHandoff,
                onRetryHandoff = taskHandoffViewModel::retryOrCheck,
                onOpenGmailSetup = {
                    taskHandoffViewModel.markReconsentPending()
                    val taskPath = activeTaskId?.let { "/tasks/$it" } ?: "/tasks"
                    val url = apiConfig.url(taskPath)
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                },
                onCreateNameChanged = taskHandoffViewModel::onCreateNameChanged,
                onCreateEmailChanged = taskHandoffViewModel::onCreateEmailChanged,
                onCreateRecipient = taskHandoffViewModel::createRecipient,
                modifier = modifier
            )
    }
}
