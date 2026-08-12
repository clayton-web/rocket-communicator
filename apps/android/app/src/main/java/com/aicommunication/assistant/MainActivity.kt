package com.aicommunication.assistant

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.aicommunication.assistant.auth.OwnerAuthViewModel
import com.aicommunication.assistant.capture.TaskCaptureViewModel
import com.aicommunication.assistant.tasks.TaskDetailViewModel
import com.aicommunication.assistant.tasks.TaskHandoffViewModel
import com.aicommunication.assistant.tasks.TaskListViewModel
import com.aicommunication.assistant.ui.OwnerAppRoot

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
        enableEdgeToEdge()
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

@Composable
fun AicaaFoundationTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
        lightColorScheme(
            primary = Color(0xFF0F766E),
            background = Color(0xFFF5F5F4),
            surface = Color(0xFFF5F5F4),
            onBackground = Color(0xFF1C1917),
            onSurface = Color(0xFF1C1917)
        ),
        content = content
    )
}
