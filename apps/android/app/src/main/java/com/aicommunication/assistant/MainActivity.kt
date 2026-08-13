package com.aicommunication.assistant

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.aicommunication.assistant.auth.OwnerAuthViewModel
import com.aicommunication.assistant.capture.TaskCaptureViewModel
import com.aicommunication.assistant.tasks.TaskDetailViewModel
import com.aicommunication.assistant.tasks.TaskHandoffViewModel
import com.aicommunication.assistant.tasks.TaskListViewModel
import com.aicommunication.assistant.ui.OwnerAppRoot
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme

class MainActivity : ComponentActivity() {
    private val authViewModel: OwnerAuthViewModel by viewModels {
        val app = application as AicaaApplication
        OwnerAuthViewModel.Factory(app, app.authRepository)
    }

    private val captureViewModel: TaskCaptureViewModel by viewModels {
        val app = application as AicaaApplication
        TaskCaptureViewModel.Factory(
            application = app,
            manualCapture = app.manualCaptureUseCase,
            onSessionInvalidated = authViewModel::notifySessionInvalidated
        )
    }

    private val taskListViewModel: TaskListViewModel by viewModels {
        val app = application as AicaaApplication
        TaskListViewModel.Factory(
            application = app,
            repository = app.taskOwnerRepository,
            onSessionInvalidated = authViewModel::notifySessionInvalidated
        )
    }

    private val taskDetailViewModel: TaskDetailViewModel by viewModels {
        val app = application as AicaaApplication
        TaskDetailViewModel.Factory(
            application = app,
            repository = app.taskOwnerRepository,
            onSessionInvalidated = authViewModel::notifySessionInvalidated
        )
    }

    private val taskHandoffViewModel: TaskHandoffViewModel by viewModels {
        val app = application as AicaaApplication
        TaskHandoffViewModel.Factory(
            application = app,
            taskRepository = app.taskOwnerRepository,
            recipientRepository = app.recipientOwnerRepository,
            gmailRepository = app.gmailOwnerRepository,
            pendingStore = app.pendingHandoffStore,
            onSessionInvalidated = authViewModel::notifySessionInvalidated
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        authViewModel.onOAuthIntent(intent)
        val darkScrim = Color.parseColor("#050506")
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(darkScrim),
            navigationBarStyle = SystemBarStyle.dark(darkScrim)
        )
        val app = application as AicaaApplication
        setContent {
            AicaaFoundationTheme {
                OwnerAppRoot(
                    authViewModel = authViewModel,
                    captureViewModel = captureViewModel,
                    taskListViewModel = taskListViewModel,
                    taskDetailViewModel = taskDetailViewModel,
                    taskHandoffViewModel = taskHandoffViewModel,
                    apiConfig = app.apiConfig
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        authViewModel.onOAuthIntent(intent)
    }
}
