package com.aicommunication.assistant.tasks

import android.app.Application
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class TaskHandoffViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private lateinit var taskRepository: TaskOwnerRepository
    private lateinit var recipientRepository: RecipientOwnerRepository
    private lateinit var gmailRepository: GmailOwnerRepository
    private lateinit var pendingStore: PendingHandoffStore

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        server = MockWebServer()
        server.start()
        val executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String? = "token"
                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        taskRepository = TaskOwnerRepository(executor)
        recipientRepository = RecipientOwnerRepository(executor)
        gmailRepository = GmailOwnerRepository(executor)
        pendingStore = PendingHandoffStore(application)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    @Test
    fun confirmHandoff_reusesPersistedIdempotencyKeyOnRetry() = runBlocking {
        enqueueLoadResponses()
        server.enqueue(
            MockResponse()
                .setResponseCode(503)
                .setBody(
                    """{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"Ambiguous."}}"""
                )
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(handoffSuccessBody(idempotentReplay = true))
        )

        val vm =
            TaskHandoffViewModel(
                application,
                taskRepository,
                recipientRepository,
                gmailRepository,
                pendingStore,
                onSessionInvalidated = {}
            )
        vm.load("task-1")
        val ready = awaitReady(vm)
        assertTrue(ready.recipients.isNotEmpty())

        vm.selectRecipient("rec-1")
        vm.openConfirm()
        vm.confirmHandoff()

        val afterFail =
            awaitReady(vm) { state ->
                state.pending != null && !state.submitting
            }
        val key = afterFail.pending?.idempotencyKey
        assertNotNull(key)

        vm.retryOrCheck()

        val success =
            awaitReady(vm) { state ->
                state.successDeliveryPath != null && !state.submitting
            }
        assertEquals("assignment_email", success.successDeliveryPath)

        repeat(3) { server.takeRequest() }
        val firstHandoff = server.takeRequest()
        val retryHandoff = server.takeRequest()
        assertEquals(key, firstHandoff.getHeader("Idempotency-Key"))
        assertEquals(key, retryHandoff.getHeader("Idempotency-Key"))
        assertEquals(firstHandoff.getHeader("If-Match"), retryHandoff.getHeader("If-Match"))
    }

    @Test
    fun load_failedAssignment_doesNotUseSuccessSemantics() = runBlocking {
        enqueueLoadResponses(deliveryStatus = "failed")
        val vm =
            TaskHandoffViewModel(
                application,
                taskRepository,
                recipientRepository,
                gmailRepository,
                pendingStore,
                onSessionInvalidated = {}
            )
        vm.load("task-1")
        val ready = awaitReady(vm)

        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        assertNull(ready.successDeliveryPath)
        assertEquals(HandoffUiState.BannerTone.Warning, ready.bannerTone)
        assertTrue(ready.banner!!.contains("failed"))
        assertFalse(ready.canConfirm)
        assertFalse(ready.task.canAssign)
    }

    private suspend fun awaitReady(
        vm: TaskHandoffViewModel,
        predicate: (HandoffUiState.Ready) -> Boolean = { true }
    ): HandoffUiState.Ready {
        withTimeout(5_000) {
            while (true) {
                val state = vm.uiState.value
                if (state is HandoffUiState.Ready && predicate(state)) {
                    return@withTimeout
                }
                delay(20)
            }
        }
        return vm.uiState.value as HandoffUiState.Ready
    }

    private fun enqueueLoadResponses(deliveryStatus: String? = null) {
        val assignment =
            if (deliveryStatus == null) {
                ""
            } else {
                """
                ,"assignment": {
                  "intendedRecipientEmail": "worker@example.com",
                  "deliveryStatus": "$deliveryStatus"
                }
                """.trimIndent()
            }
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "task-1",
                      "etag": "\"v1\"",
                      "status": "open",
                      "summaryPoints": [
                        {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
                      ]
                      $assignment
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
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "status": "connected",
                      "canSend": true,
                      "requiresSendReconsent": false,
                      "readonlyScope": true
                    }
                    """.trimIndent()
                )
        )
    }

    private fun handoffSuccessBody(idempotentReplay: Boolean): String {
        return """
        {
          "task": {
            "id": "task-1",
            "etag": "\"v2\"",
            "status": "open",
            "summaryPoints": [
              {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
            ],
            "assignment": {
              "intendedRecipientEmail": "worker@example.com",
              "deliveryStatus": "sent"
            }
          },
          "deliveryPath": "assignment_email",
          "deliveryStatus": "sent",
          "recipient": {
            "id": "rec-1",
            "displayName": "Worker",
            "email": "worker@example.com",
            "active": true
          },
          "capabilityId": "cap-1",
          "requiresSendReconsent": false,
          "idempotentReplay": $idempotentReplay
        }
        """.trimIndent()
    }
}
