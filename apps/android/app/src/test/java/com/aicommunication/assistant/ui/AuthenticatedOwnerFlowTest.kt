package com.aicommunication.assistant.ui

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import com.aicommunication.assistant.capture.ManualCaptureRepository
import com.aicommunication.assistant.capture.ManualCaptureUseCase
import com.aicommunication.assistant.capture.PendingCaptureStore
import com.aicommunication.assistant.capture.ProposalOwnerRepository
import com.aicommunication.assistant.capture.TaskCaptureViewModel
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.contracts.models.AuthenticatedRole
import com.aicommunication.assistant.contracts.models.Session
import com.aicommunication.assistant.messages.FakeMessagesNotificationAccess
import com.aicommunication.assistant.messages.MessagesEligibility
import com.aicommunication.assistant.messages.MessagesIntakeViewModel
import com.aicommunication.assistant.messages.MessagesLocalReviewStore
import com.aicommunication.assistant.messages.MessagesNotificationShapeProbe
import com.aicommunication.assistant.messages.MessagesOwnerRepository
import com.aicommunication.assistant.messages.observation
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.tasks.GmailIntakeViewModel
import com.aicommunication.assistant.tasks.GmailOwnerRepository
import com.aicommunication.assistant.tasks.PendingHandoffStore
import com.aicommunication.assistant.tasks.RecipientOwnerRepository
import com.aicommunication.assistant.tasks.ReminderOwnerRepository
import com.aicommunication.assistant.tasks.TaskDetailViewModel
import com.aicommunication.assistant.tasks.TaskHandoffViewModel
import com.aicommunication.assistant.tasks.TaskListViewModel
import com.aicommunication.assistant.ui.theme.AicaaFoundationTheme
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * S5.2 Task transition uses the existing lightweight destination enum, not Navigation-Compose.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class, qualifiers = "w411dp-h891dp")
class AuthenticatedOwnerFlowTest {
    @get:Rule
    val composeRule = createComposeRule()

    private lateinit var application: Application
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun acceptedProposalRoutesToExistingTaskDetail() {
        enqueueCaptureSuccess()
        enqueueRecipients()
        enqueueApproveSuccess()
        enqueueTaskDetail()

        val executor = executor()
        val captureViewModel =
            TaskCaptureViewModel(
                application = application,
                manualCapture =
                ManualCaptureUseCase(
                    repository = ManualCaptureRepository(executor),
                    pendingStore =
                    PendingCaptureStore.forTests(
                        application.getSharedPreferences("flow-capture", 0)
                    )
                ),
                proposalRepository = ProposalOwnerRepository(executor),
                recipientRepository = RecipientOwnerRepository(executor),
                onSessionInvalidated = {}
            )
        val taskRepository = TaskOwnerRepository(executor)

        composeRule.setContent {
            AicaaFoundationTheme {
                AuthenticatedOwnerFlow(
                    session =
                    Session(
                        ownerId = "owner-1",
                        organizationId = "org-1",
                        role = AuthenticatedRole.owner,
                        displayName = "Ada Owner"
                    ),
                    signingOut = false,
                    onSignOut = {},
                    apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                    captureViewModel = captureViewModel,
                    messagesIntakeViewModel = messagesViewModel(),
                    gmailIntakeViewModel =
                    GmailIntakeViewModel(
                        application,
                        GmailOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskListViewModel =
                    TaskListViewModel(application, taskRepository, onSessionInvalidated = {}),
                    taskDetailViewModel =
                    TaskDetailViewModel(
                        application,
                        taskRepository,
                        ReminderOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskHandoffViewModel =
                    TaskHandoffViewModel(
                        application,
                        taskRepository,
                        RecipientOwnerRepository(executor),
                        GmailOwnerRepository(executor),
                        PendingHandoffStore(application),
                        onSessionInvalidated = {}
                    )
                )
            }
        }

        composeRule.onNodeWithTag("capture_entry_button").performClick()
        composeRule.onNodeWithTag("capture_field").performTextReplacement("Call the roofer")
        composeRule.onNodeWithTag("capture_save_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("capture_accept_button")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("capture_accept_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("capture_accept_recipient_rec-1")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("capture_accept_me").performClick()
        composeRule.onNodeWithTag("capture_accept_confirm").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("task_detail_screen")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("task_detail_screen").assertIsDisplayed()
    }

    @Test
    fun gmailReviewRoutesZeroAndNSuggestionsOntoExistingProposalSurface() {
        enqueueIntake()
        enqueueGmailReviewSuccess()

        val executor = executor()
        val captureViewModel =
            TaskCaptureViewModel(
                application = application,
                manualCapture =
                ManualCaptureUseCase(
                    repository = ManualCaptureRepository(executor),
                    pendingStore =
                    PendingCaptureStore.forTests(
                        application.getSharedPreferences("flow-gmail", 0)
                    )
                ),
                proposalRepository = ProposalOwnerRepository(executor),
                recipientRepository = RecipientOwnerRepository(executor),
                onSessionInvalidated = {}
            )
        val taskRepository = TaskOwnerRepository(executor)

        composeRule.setContent {
            AicaaFoundationTheme {
                AuthenticatedOwnerFlow(
                    session =
                    Session(
                        ownerId = "owner-1",
                        organizationId = "org-1",
                        role = AuthenticatedRole.owner,
                        displayName = "Ada Owner"
                    ),
                    signingOut = false,
                    onSignOut = {},
                    apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                    captureViewModel = captureViewModel,
                    messagesIntakeViewModel = messagesViewModel(),
                    gmailIntakeViewModel =
                    GmailIntakeViewModel(
                        application,
                        GmailOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskListViewModel =
                    TaskListViewModel(application, taskRepository, onSessionInvalidated = {}),
                    taskDetailViewModel =
                    TaskDetailViewModel(
                        application,
                        taskRepository,
                        ReminderOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskHandoffViewModel =
                    TaskHandoffViewModel(
                        application,
                        taskRepository,
                        RecipientOwnerRepository(executor),
                        GmailOwnerRepository(executor),
                        PendingHandoffStore(application),
                        onSessionInvalidated = {}
                    )
                )
            }
        }

        composeRule.onNodeWithTag("gmail_entry_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("gmail_intake_item_evt_review_ok")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("gmail_intake_item_evt_review_ok").performClick()
        composeRule.onNodeWithTag("gmail_review_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("capture_result")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("capture_result").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_button").assertIsDisplayed()
        composeRule.onNodeWithText("You reviewed: Quote revision").assertIsDisplayed()
    }

    @Test
    fun messagesEntry_opensLocalMessagesSurfaceWithoutNetwork() {
        val executor = executor()
        val captureViewModel =
            TaskCaptureViewModel(
                application = application,
                manualCapture =
                ManualCaptureUseCase(
                    repository = ManualCaptureRepository(executor),
                    pendingStore =
                    PendingCaptureStore.forTests(
                        application.getSharedPreferences("flow-messages", 0)
                    )
                ),
                proposalRepository = ProposalOwnerRepository(executor),
                recipientRepository = RecipientOwnerRepository(executor),
                onSessionInvalidated = {}
            )
        val taskRepository = TaskOwnerRepository(executor)

        composeRule.setContent {
            AicaaFoundationTheme {
                AuthenticatedOwnerFlow(
                    session =
                    Session(
                        ownerId = "owner-1",
                        organizationId = "org-1",
                        role = AuthenticatedRole.owner,
                        displayName = "Ada Owner"
                    ),
                    signingOut = false,
                    onSignOut = {},
                    apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                    captureViewModel = captureViewModel,
                    messagesIntakeViewModel = messagesViewModel(),
                    gmailIntakeViewModel =
                    GmailIntakeViewModel(
                        application,
                        GmailOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskListViewModel =
                    TaskListViewModel(application, taskRepository, onSessionInvalidated = {}),
                    taskDetailViewModel =
                    TaskDetailViewModel(
                        application,
                        taskRepository,
                        ReminderOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskHandoffViewModel =
                    TaskHandoffViewModel(
                        application,
                        taskRepository,
                        RecipientOwnerRepository(executor),
                        GmailOwnerRepository(executor),
                        PendingHandoffStore(application),
                        onSessionInvalidated = {}
                    )
                )
            }
        }

        composeRule.onNodeWithTag("messages_entry_button").performClick()
        composeRule.onNodeWithTag("messages_intake_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_intake_access_needed").assertIsDisplayed()
        composeRule.onNodeWithText("Review with Rocket").assertDoesNotExist()
        assertEquals(0, server.requestCount)
    }

    @Test
    fun messagesReviewRoutesSuggestionsOntoExistingProposalSurface() {
        enqueueMessagesReviewSuccess()
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val eligible = observation()
        store.record(eligible, MessagesEligibility.classify(eligible))

        val executor = executor()
        val captureViewModel =
            TaskCaptureViewModel(
                application = application,
                manualCapture =
                ManualCaptureUseCase(
                    repository = ManualCaptureRepository(executor),
                    pendingStore =
                    PendingCaptureStore.forTests(
                        application.getSharedPreferences("flow-messages-review", 0)
                    )
                ),
                proposalRepository = ProposalOwnerRepository(executor),
                recipientRepository = RecipientOwnerRepository(executor),
                onSessionInvalidated = {}
            )
        val taskRepository = TaskOwnerRepository(executor)

        composeRule.setContent {
            AicaaFoundationTheme {
                AuthenticatedOwnerFlow(
                    session =
                    Session(
                        ownerId = "owner-1",
                        organizationId = "org-1",
                        role = AuthenticatedRole.owner,
                        displayName = "Ada Owner"
                    ),
                    signingOut = false,
                    onSignOut = {},
                    apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                    captureViewModel = captureViewModel,
                    messagesIntakeViewModel = messagesViewModel(store = store, enabled = true),
                    gmailIntakeViewModel =
                    GmailIntakeViewModel(
                        application,
                        GmailOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskListViewModel =
                    TaskListViewModel(application, taskRepository, onSessionInvalidated = {}),
                    taskDetailViewModel =
                    TaskDetailViewModel(
                        application,
                        taskRepository,
                        ReminderOwnerRepository(executor),
                        onSessionInvalidated = {}
                    ),
                    taskHandoffViewModel =
                    TaskHandoffViewModel(
                        application,
                        taskRepository,
                        RecipientOwnerRepository(executor),
                        GmailOwnerRepository(executor),
                        PendingHandoffStore(application),
                        onSessionInvalidated = {}
                    )
                )
            }
        }

        composeRule.onNodeWithTag("messages_entry_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("messages_intake_item_${eligible.notificationKey}")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("messages_intake_item_${eligible.notificationKey}").performClick()
        composeRule.onNodeWithTag("messages_review_button").performClick()
        composeRule.waitUntil(5_000) {
            composeRule
                .onAllNodesWithTag("capture_result")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        composeRule.onNodeWithTag("capture_result").assertIsDisplayed()
        composeRule.onNodeWithTag("capture_accept_button").assertIsDisplayed()
        composeRule.onNodeWithText("You reviewed: Can you call me tomorrow").assertIsDisplayed()
        composeRule.onNodeWithTag("messages_review_another_button").assertIsDisplayed()
        composeRule.onNodeWithTag("gmail_review_another_button").assertDoesNotExist()
        assertEquals(1, server.requestCount)
        assertEquals("/api/v1/messages/reviews", server.takeRequest().path)
    }

    private fun messagesViewModel(
        store: MessagesLocalReviewStore = MessagesLocalReviewStore(),
        enabled: Boolean = false
    ) = MessagesIntakeViewModel(
        application = application,
        store = store,
        access = FakeMessagesNotificationAccess(enabled = enabled),
        shapeProbe = MessagesNotificationShapeProbe(enabled = false),
        repository = MessagesOwnerRepository(executor()),
        onSessionInvalidated = {}
    )

    private fun executor() = OwnerApiExecutor(
        apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
        httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
        tokenProvider =
        object : AccessTokenProvider {
            override suspend fun currentAccessToken(): String? = "access-token"
            override suspend fun refreshAccessToken(): String? = null
        },
        connectivity = FixedConnectivityMonitor(validated = true)
    )

    private fun enqueueCaptureSuccess() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "idempotentReplay": false,
                      "interpretedAt": "2026-08-12T15:00:00.000Z",
                      "taskSuggestions": [
                        {
                          "id": "s1",
                          "status": "pending",
                          "version": 1,
                          "etag": "etag-s1",
                          "createdAt": "2026-08-12T15:00:00.000Z",
                          "summaryPoints": [
                            {
                              "id": "sp-s1",
                              "kind": "confirmed_fact",
                              "label": "Captured",
                              "order": 0,
                              "value": "Call the roofer"
                            }
                          ]
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueRecipients() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "items": [
                        {
                          "id": "rec-1",
                          "displayName": "Worker",
                          "email": "worker@example.com",
                          "active": true
                        }
                      ],
                      "nextCursor": null
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueApproveSuccess() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "suggestion": {
                        "id": "s1",
                        "status": "approved",
                        "version": 2,
                        "etag": "etag-s1-v2",
                        "createdAt": "2026-08-12T15:00:00.000Z",
                        "summaryPoints": [
                          {
                            "id": "sp-s1",
                            "kind": "confirmed_fact",
                            "label": "Captured",
                            "order": 0,
                            "value": "Call the roofer"
                          }
                        ],
                        "approvedTaskId": "task-1"
                      },
                      "task": {
                        "id": "task-1",
                        "etag": "task-task-1-v1",
                        "status": "open",
                        "version": 1,
                        "summaryPoints": [
                          {
                            "id": "sp-s1",
                            "kind": "confirmed_fact",
                            "label": "Captured",
                            "order": 0,
                            "value": "Call the roofer"
                          }
                        ]
                      }
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueIntake() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "items": [
                        {
                          "id": "evt_review_ok",
                          "fromAddress": "sender@example.com",
                          "subject": "Quote revision",
                          "snippet": "Please send the revised quote",
                          "receivedAt": "2026-08-13T18:00:00.000Z"
                        }
                      ],
                      "nextCursor": null
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueGmailReviewSuccess() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "idempotentReplay": false,
                      "interpretedAt": "2026-08-13T18:00:00.000Z",
                      "taskSuggestions": [
                        {
                          "id": "s1",
                          "status": "pending",
                          "version": 1,
                          "etag": "etag-s1",
                          "createdAt": "2026-08-13T18:00:00.000Z",
                          "summaryPoints": [
                            {
                              "id": "sp-s1",
                              "kind": "request",
                              "label": "Request",
                              "order": 0,
                              "value": "Send the revised quote"
                            }
                          ]
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueMessagesReviewSuccess() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "idempotentReplay": false,
                      "interpretedAt": "2026-08-13T18:00:00.000Z",
                      "taskSuggestions": [
                        {
                          "id": "s1",
                          "status": "pending",
                          "version": 1,
                          "etag": "etag-s1",
                          "createdAt": "2026-08-13T18:00:00.000Z",
                          "summaryPoints": [
                            {
                              "id": "sp-s1",
                              "kind": "request",
                              "label": "Request",
                              "order": 0,
                              "value": "Call Ada tomorrow"
                            }
                          ]
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueTaskDetail() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "task-1",
                      "etag": "task-task-1-v1",
                      "status": "open",
                      "version": 1,
                      "summaryPoints": [
                        {
                          "id": "sp-s1",
                          "kind": "confirmed_fact",
                          "label": "Captured",
                          "order": 0,
                          "value": "Call the roofer"
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "taskId": "task-1",
                      "etag": "\"task-reminder-task-1-v0\"",
                      "state": "no_due_date",
                      "requiresOwnerAttention": false,
                      "dueLocalDate": null
                    }
                    """.trimIndent()
                )
        )
    }
}
