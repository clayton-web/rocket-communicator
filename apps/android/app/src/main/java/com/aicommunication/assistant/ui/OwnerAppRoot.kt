package com.aicommunication.assistant.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.aicommunication.assistant.R
import com.aicommunication.assistant.auth.AuthUiState
import com.aicommunication.assistant.auth.OwnerAuthViewModel
import com.aicommunication.assistant.capture.TaskCaptureViewModel
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.tasks.TaskDetailViewModel
import com.aicommunication.assistant.tasks.TaskHandoffViewModel
import com.aicommunication.assistant.tasks.TaskListViewModel
import com.aicommunication.assistant.ui.theme.AicaaCircularProgressIndicator
import com.aicommunication.assistant.ui.theme.AicaaColors

@Composable
fun OwnerAppRoot(
    authViewModel: OwnerAuthViewModel,
    captureViewModel: TaskCaptureViewModel,
    taskListViewModel: TaskListViewModel,
    taskDetailViewModel: TaskDetailViewModel,
    taskHandoffViewModel: TaskHandoffViewModel,
    apiConfig: ApiConfig,
    modifier: Modifier = Modifier
) {
    val state by authViewModel.uiState.collectAsState()

    Surface(modifier = modifier.fillMaxSize(), color = AicaaColors.background) {
        when (val current = state) {
            AuthUiState.Loading -> LoadingPane(stringResource(R.string.session_loading))
            AuthUiState.SigningIn ->
                SignInScreen(
                    errorMessage = null,
                    connectivityIssue = false,
                    signingIn = true,
                    onSignIn = authViewModel::signIn,
                    onRetry = authViewModel::retryConnectivity
                )
            AuthUiState.SigningOut -> LoadingPane(stringResource(R.string.signing_out))
            is AuthUiState.SignedOut ->
                SignInScreen(
                    errorMessage = current.errorMessage,
                    connectivityIssue = current.connectivityIssue,
                    signingIn = false,
                    onSignIn = authViewModel::signIn,
                    onRetry = authViewModel::retryConnectivity
                )
            is AuthUiState.Authenticated ->
                AuthenticatedOwnerFlow(
                    session = current.session,
                    signingOut = false,
                    onSignOut = authViewModel::signOut,
                    apiConfig = apiConfig,
                    captureViewModel = captureViewModel,
                    taskListViewModel = taskListViewModel,
                    taskDetailViewModel = taskDetailViewModel,
                    taskHandoffViewModel = taskHandoffViewModel
                )
        }
    }
}

@Composable
private fun LoadingPane(label: String) {
    Box(
        modifier =
        Modifier
            .fillMaxSize()
            .testTag("auth_loading"),
        contentAlignment = Alignment.Center
    ) {
        AicaaCircularProgressIndicator()
        Text(
            text = label,
            color = AicaaColors.ink,
            modifier = Modifier.align(Alignment.BottomCenter)
        )
    }
}
