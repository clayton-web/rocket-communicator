package com.aicommunication.assistant.tasks

import android.app.Application
import com.aicommunication.assistant.capture.TaskOwnerRepository
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
class TaskReturnToOwnerViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private lateinit var taskRepository: TaskOwnerRepository
    private lateinit var reminderRepository: ReminderOwnerRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        server = MockWebServer()
        server.start()
        val executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient =
                OkHttpClient.Builder()
                    .connectTimeout(1, TimeUnit.SECONDS)
                    .readTimeout(1, TimeUnit.SECONDS)
                    .writeTimeout(1, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(false)
                    .build(),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String? = "token"
                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        taskRepository = TaskOwnerRepository(executor)
        reminderRepository = ReminderOwnerRepository(executor)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    @Test
    fun confirmedSuccess_postsOnceThenAuthoritativeReread() = runBlocking {
        val vm = loadFailed()
        enqueueTask(assigned = false, etag = "\"v2\"")
        enqueueTask(assigned = false, etag = "\"v2\"")
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertFalse(ready.task.isAssigned)
        assertFalse(ready.task.canReturnFailedAssignmentToOwner)
        assertTrue(ready.task.canAssign)
        assertEquals("This Task is unassigned. You can hand it off again when ready.", ready.banner)
        assertNull(ready.errorMessage)

        drainLoadRequests()
        val post = server.takeRequest()
        assertEquals("POST", post.method)
        assertTrue(post.path!!.endsWith("/api/v1/tasks/t1/return-to-owner"))
        assertEquals(TASK_ETAG, post.getHeader("If-Match"))
        assertNull(post.getHeader("Idempotency-Key"))
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun duplicateTaps_doNotIssueDuplicatePosts() = runBlocking {
        val vm = loadFailed()
        enqueueTask(assigned = false, etag = "\"v2\"", delayMs = 250)
        enqueueTask(assigned = false, etag = "\"v2\"")
        enqueueReminder()

        vm.returnToOwner()
        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertFalse(ready.task.isAssigned)
        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun stale412_doesNotRepostAndPerformsGet() = runBlocking {
        val vm = loadFailed()
        server.enqueue(
            MockResponse()
                .setResponseCode(412)
                .setBody("""{"error":{"code":"PRECONDITION_FAILED","message":"stale"}}""")
        )
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = "\"v9\"")
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        assertTrue(ready.errorMessage!!.contains("changed"))
        assertNull(ready.banner)

        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun ambiguousTimeout_doesNotClaimSuccessAndReconcilesWithGet() = runBlocking {
        val vm = loadFailed()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = TASK_ETAG)
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        assertFalse(ready.task.canAssign)
        assertNull(ready.banner)
        assertTrue(
            ready.errorMessage!!.contains("did not get an answer") ||
                ready.errorMessage!!.contains("Cannot reach Rocket")
        )

        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun malformedResponse_doesNotClaimSuccessAndReconcilesWithGet() = runBlocking {
        val vm = loadFailed()
        server.enqueue(MockResponse().setResponseCode(200).setBody(""))
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = TASK_ETAG)
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        assertNull(ready.banner)
        assertTrue(ready.errorMessage!!.contains("did not get an answer"))
        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun ambiguousReconciliation_unassignedConvergesToRecovered() = runBlocking {
        val vm = loadFailed()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        enqueueTask(assigned = false, etag = "\"v2\"")
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertFalse(ready.task.isAssigned)
        assertFalse(ready.task.canReturnFailedAssignmentToOwner)
        assertTrue(ready.task.canAssign)
        assertTrue(ready.banner!!.contains("now unassigned"))
        assertNull(ready.errorMessage)
        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals(5, server.requestCount)
    }

    @Test
    fun ambiguousReconciliation_stillFailedKeepsRecoveryWithoutResend() = runBlocking {
        val vm = loadFailed()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = TASK_ETAG)
        enqueueReminder()

        vm.returnToOwner()
        val ready = awaitReady(vm)

        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        assertEquals(5, server.requestCount)

        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = TASK_ETAG)
        enqueueReminder()
        vm.returnToOwner()
        val afterSecond = awaitReady(vm)
        assertTrue(afterSecond.task.canReturnFailedAssignmentToOwner)
        assertEquals(8, server.requestCount)
        drainLoadRequests()
        assertEquals("POST", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals("POST", server.takeRequest().method)
    }

    private suspend fun loadFailed(): TaskDetailViewModel {
        enqueueTask(assigned = true, deliveryStatus = "failed", etag = TASK_ETAG)
        enqueueReminder()
        val vm = viewModel()
        vm.load("t1")
        val ready = awaitReady(vm)
        assertTrue(ready.task.canReturnFailedAssignmentToOwner)
        return vm
    }

    private fun viewModel() = TaskDetailViewModel(
        application,
        taskRepository,
        reminderRepository,
        onSessionInvalidated = {}
    )

    private suspend fun awaitReady(vm: TaskDetailViewModel): TaskDetailUiState.Ready {
        withTimeout(8_000) {
            while (vm.uiState.value is TaskDetailUiState.Loading) {
                delay(20)
            }
            while ((vm.uiState.value as? TaskDetailUiState.Ready)?.mutating == true) {
                delay(20)
            }
        }
        return vm.uiState.value as TaskDetailUiState.Ready
    }

    private fun drainLoadRequests() {
        repeat(2) { server.takeRequest() }
    }

    private fun enqueueTask(
        assigned: Boolean,
        deliveryStatus: String? = null,
        etag: String,
        delayMs: Long = 0
    ) {
        val encodedEtag = etag.replace("\"", "\\\"")
        val assignment =
            if (assigned) {
                """
                ,"assignment": {
                  "intendedRecipientEmail": "alex@example.com",
                  "deliveryStatus": "${deliveryStatus ?: "sent"}"
                }
                """.trimIndent()
            } else {
                ""
            }
        val response =
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "t1",
                      "etag": "$encodedEtag",
                      "status": "in_progress",
                      "summaryPoints": [
                        {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Call painter"}
                      ]
                      $assignment
                    }
                    """.trimIndent()
                )
        if (delayMs > 0) {
            response.setBodyDelay(delayMs, TimeUnit.MILLISECONDS)
        }
        server.enqueue(response)
    }

    private fun enqueueReminder() {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "taskId": "t1",
                      "etag": "\"task-reminder-t1-v0\"",
                      "state": "no_due_date",
                      "requiresOwnerAttention": false,
                      "dueLocalDate": null,
                      "advanceEnabled": null,
                      "advance": null
                    }
                    """.trimIndent()
                )
        )
    }

    companion object {
        private const val TASK_ETAG = "\"task-t1-v4\""
    }
}
