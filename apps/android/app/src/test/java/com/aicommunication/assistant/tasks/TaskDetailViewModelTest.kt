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
import org.junit.Assert.assertNotEquals
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
class TaskDetailViewModelTest {
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
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
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
    fun load_displaysCanonicalDueDateFromTaskRead() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-12", derivedUrgency = "overdue")
        enqueueReminder(etag = REMINDER_V1, dueLocalDate = "2026-08-12")

        val ready = loadReady()
        assertEquals("2026-08-12", ready.task.dueLocalDate)
        assertEquals("overdue", ready.task.derivedUrgency)
        assertEquals(REMINDER_V1, ready.reminderEtag)
        assertNotEquals(TASK_ETAG, ready.reminderEtag)
        assertEquals("/api/v1/tasks/t1", server.takeRequest().path)
        assertEquals("/api/v1/tasks/t1/reminder", server.takeRequest().path)
    }

    @Test
    fun setDueDate_putsDateOnlyWithReminderEtagThenRefreshesTask() = runBlocking {
        enqueueTask(dueLocalDate = null, derivedUrgency = null)
        enqueueReminder(etag = REMINDER_V0, dueLocalDate = null)
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(etag = REMINDER_V1, dueLocalDate = "2026-08-20")
        enqueueTask(dueLocalDate = "2026-08-20", derivedUrgency = "due_soon")
        vm.setDueDate("2026-08-20")
        val ready = awaitReady(vm)

        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("/api/v1/tasks/t1/reminder", put.path)
        assertEquals(REMINDER_V0, put.getHeader("If-Match"))
        assertNotEquals(TASK_ETAG, put.getHeader("If-Match"))
        assertEquals("""{"dueLocalDate":"2026-08-20"}""", put.body.readUtf8())

        val refresh = server.takeRequest()
        assertEquals("GET", refresh.method)
        assertEquals("/api/v1/tasks/t1", refresh.path)
        assertEquals(4, server.requestCount)

        assertEquals("2026-08-20", ready.task.dueLocalDate)
        assertEquals("due_soon", ready.task.derivedUrgency)
        assertEquals(REMINDER_V1, ready.reminderEtag)
        assertEquals("Deadline saved.", ready.banner)
    }

    @Test
    fun clearDueDate_deletesWithReminderEtagAndClearsDisplay() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-20", derivedUrgency = "due_soon")
        enqueueReminder(etag = REMINDER_V1, dueLocalDate = "2026-08-20")
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(etag = REMINDER_V2, dueLocalDate = null)
        enqueueTask(dueLocalDate = null, derivedUrgency = null)
        vm.clearDueDate()
        val ready = awaitReady(vm)

        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/api/v1/tasks/t1/reminder", delete.path)
        assertEquals(REMINDER_V1, delete.getHeader("If-Match"))
        assertNotEquals(TASK_ETAG, delete.getHeader("If-Match"))

        assertNull(ready.task.dueLocalDate)
        assertNull(ready.task.derivedUrgency)
        assertEquals(REMINDER_V2, ready.reminderEtag)
        assertEquals("Deadline removed.", ready.banner)
    }

    @Test
    fun reminder412_doesNotRetryAndRereadsCanonicalState() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-12", derivedUrgency = "overdue")
        enqueueReminder(etag = REMINDER_V1, dueLocalDate = "2026-08-12")
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        server.enqueue(
            MockResponse()
                .setResponseCode(412)
                .setBody(
                    """{"error":{"code":"PRECONDITION_FAILED","message":"stale"}}"""
                )
        )
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        enqueueReminder(etag = REMINDER_V2, dueLocalDate = "2026-08-21")
        vm.setDueDate("2026-08-20")
        val ready = awaitReady(vm)

        assertEquals("PUT", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)

        assertEquals("2026-08-21", ready.task.dueLocalDate)
        assertEquals("due_soon", ready.task.derivedUrgency)
        assertEquals(REMINDER_V2, ready.reminderEtag)
        assertTrue(ready.errorMessage!!.contains("schedule changed"))
        assertNull(ready.banner)
    }

    @Test
    fun setAdvanceEnabled_putsPreferenceWithReminderEtag() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        enqueueReminder(
            etag = REMINDER_V1,
            dueLocalDate = "2026-08-21",
            advanceEnabled = true,
            disposition = "scheduled",
            occurrenceLocalDate = "2026-08-20"
        )
        val vm = viewModel()
        vm.load("t1")
        val loaded = awaitReady(vm)
        assertEquals(true, loaded.advanceEnabled)
        assertEquals("2026-08-20", loaded.automaticAdvanceLocalDate)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(
            etag = REMINDER_V2,
            dueLocalDate = "2026-08-21",
            advanceEnabled = false,
            disposition = "not_enabled",
            occurrenceLocalDate = "2026-08-20"
        )
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        vm.setAdvanceEnabled(false)
        val ready = awaitReady(vm)

        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("/api/v1/tasks/t1/reminder", put.path)
        assertEquals(REMINDER_V1, put.getHeader("If-Match"))
        assertNotEquals(TASK_ETAG, put.getHeader("If-Match"))
        assertEquals(
            """{"dueLocalDate":"2026-08-21","advanceEnabled":false}""",
            put.body.readUtf8()
        )
        assertEquals(false, ready.advanceEnabled)
        assertEquals("2026-08-21", ready.task.dueLocalDate)
        assertNull(ready.automaticAdvanceLocalDate)
        assertEquals("Automatic reminder updated.", ready.banner)
        assertEquals(4, server.requestCount)
    }

    @Test
    fun advance412_doesNotRetryAndRereadsCanonicalState() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        enqueueReminder(
            etag = REMINDER_V1,
            dueLocalDate = "2026-08-21",
            advanceEnabled = true,
            disposition = "scheduled",
            occurrenceLocalDate = "2026-08-20"
        )
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        server.enqueue(
            MockResponse()
                .setResponseCode(412)
                .setBody(
                    """{"error":{"code":"PRECONDITION_FAILED","message":"stale"}}"""
                )
        )
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        enqueueReminder(
            etag = REMINDER_V2,
            dueLocalDate = "2026-08-21",
            advanceEnabled = false,
            disposition = "not_enabled",
            occurrenceLocalDate = "2026-08-20"
        )
        vm.setAdvanceEnabled(false)
        val ready = awaitReady(vm)

        assertEquals("PUT", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals("GET", server.takeRequest().method)
        assertEquals(5, server.requestCount)
        assertEquals(false, ready.advanceEnabled)
        assertEquals("2026-08-21", ready.task.dueLocalDate)
        assertTrue(ready.errorMessage!!.contains("schedule changed"))
        assertNull(ready.banner)
    }

    @Test
    fun dueDateChange_omitsAdvanceEnabledSoServerPreservesPreference() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-12", derivedUrgency = "overdue")
        enqueueReminder(
            etag = REMINDER_V1,
            dueLocalDate = "2026-08-12",
            advanceEnabled = false,
            disposition = "not_enabled",
            occurrenceLocalDate = "2026-08-11"
        )
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(
            etag = REMINDER_V2,
            dueLocalDate = "2026-08-21",
            advanceEnabled = false,
            disposition = "not_enabled",
            occurrenceLocalDate = "2026-08-20"
        )
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        vm.setDueDate("2026-08-21")
        val ready = awaitReady(vm)

        assertEquals("""{"dueLocalDate":"2026-08-21"}""", server.takeRequest().body.readUtf8())
        assertEquals(false, ready.advanceEnabled)
        assertEquals("2026-08-21", ready.task.dueLocalDate)
        assertNull(ready.automaticAdvanceLocalDate)
    }

    @Test
    fun reestablishAfterRemove_omitsAdvanceEnabledForServerDefault() = runBlocking {
        enqueueTask(dueLocalDate = "2026-08-12", derivedUrgency = "overdue")
        enqueueReminder(
            etag = REMINDER_V1,
            dueLocalDate = "2026-08-12",
            advanceEnabled = false,
            disposition = "not_enabled",
            occurrenceLocalDate = "2026-08-11"
        )
        val vm = viewModel()
        vm.load("t1")
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(etag = REMINDER_V2, dueLocalDate = null)
        enqueueTask(dueLocalDate = null, derivedUrgency = null)
        vm.clearDueDate()
        awaitReady(vm)
        server.takeRequest()
        server.takeRequest()

        enqueueReminder(
            etag = REMINDER_V1,
            dueLocalDate = "2026-08-21",
            advanceEnabled = true,
            disposition = "scheduled",
            occurrenceLocalDate = "2026-08-20"
        )
        enqueueTask(dueLocalDate = "2026-08-21", derivedUrgency = "due_soon")
        vm.setDueDate("2026-08-21")
        val ready = awaitReady(vm)

        assertEquals("""{"dueLocalDate":"2026-08-21"}""", server.takeRequest().body.readUtf8())
        assertEquals(true, ready.advanceEnabled)
        assertEquals("2026-08-20", ready.automaticAdvanceLocalDate)
    }

    private fun viewModel() = TaskDetailViewModel(
        application,
        taskRepository,
        reminderRepository,
        onSessionInvalidated = {}
    )

    private suspend fun loadReady(): TaskDetailUiState.Ready {
        val vm = viewModel()
        vm.load("t1")
        return awaitReady(vm)
    }

    private suspend fun awaitReady(vm: TaskDetailViewModel): TaskDetailUiState.Ready {
        withTimeout(3_000) {
            while (vm.uiState.value is TaskDetailUiState.Loading) {
                delay(20)
            }
            while ((vm.uiState.value as? TaskDetailUiState.Ready)?.mutating == true) {
                delay(20)
            }
        }
        return vm.uiState.value as TaskDetailUiState.Ready
    }

    private fun enqueueTask(dueLocalDate: String?, derivedUrgency: String?) {
        val due = dueLocalDate?.let { "\"$it\"" } ?: "null"
        val urgency = derivedUrgency?.let { "\"$it\"" } ?: "null"
        val encodedEtag = TASK_ETAG.replace("\"", "\\\"")
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "t1",
                      "etag": "$encodedEtag",
                      "status": "open",
                      "dueLocalDate": $due,
                      "derivedUrgency": $urgency,
                      "summaryPoints": [
                        {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Call painter"}
                      ]
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueReminder(
        etag: String,
        dueLocalDate: String?,
        advanceEnabled: Boolean? = null,
        disposition: String? = null,
        occurrenceLocalDate: String? = null
    ) {
        val due = dueLocalDate?.let { "\"$it\"" } ?: "null"
        val encodedEtag = etag.replace("\"", "\\\"")
        val enabled =
            when (advanceEnabled) {
                null -> "null"
                else -> advanceEnabled.toString()
            }
        val advance =
            if (disposition == null) {
                "null"
            } else {
                val occurrence =
                    if (occurrenceLocalDate == null) {
                        "null"
                    } else {
                        """{"localDate":"$occurrenceLocalDate","at":"2026-08-20T16:00:00.000Z"}"""
                    }
                """{"disposition":"$disposition","occurrence":$occurrence}"""
            }
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "taskId": "t1",
                      "etag": "$encodedEtag",
                      "state": "active",
                      "requiresOwnerAttention": false,
                      "dueLocalDate": $due,
                      "advanceEnabled": $enabled,
                      "advance": $advance
                    }
                    """.trimIndent()
                )
        )
    }

    companion object {
        private const val TASK_ETAG = "\"task-t1-v4\""
        private const val REMINDER_V0 = "\"task-reminder-t1-v0\""
        private const val REMINDER_V1 = "\"task-reminder-t1-v1\""
        private const val REMINDER_V2 = "\"task-reminder-t1-v2\""
    }
}
