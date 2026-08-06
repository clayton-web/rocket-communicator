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
class TaskListViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private lateinit var repository: TaskOwnerRepository
    private var sessionInvalidated = 0

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        sessionInvalidated = 0
        server = MockWebServer()
        server.start()
        repository =
            TaskOwnerRepository(
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
            )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    @Test
    fun load_successShowsTasks() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                        {
                          "items": [
                            {
                              "id": "t1",
                              "etag": "e1",
                              "status": "open",
                              "summaryPoints": [
                                {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Call painter"}
                              ]
                            }
                          ],
                          "nextCursor": null
                        }
                    """.trimIndent()
                )
        )
        val vm =
            TaskListViewModel(
                application,
                repository,
                onSessionInvalidated = { sessionInvalidated++ }
            )

        vm.load()
        val ready = awaitReady(vm)
        assertEquals(1, ready.tasks.size)
        assertEquals("Call painter", ready.tasks[0].displayTitle)
        assertTrue(ready.tasks[0].isOwnerWork)
        assertEquals(0, sessionInvalidated)
    }

    @Test
    fun load_unauthorizedInvalidatesSession() = runBlocking {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setBody("""{"error":{"code":"UNAUTHORIZED","message":"no"}}""")
        )
        val vm =
            TaskListViewModel(
                application,
                repository,
                onSessionInvalidated = { sessionInvalidated++ }
            )

        vm.load()
        withTimeout(3_000) {
            while (vm.uiState.value is TaskListUiState.Loading) {
                delay(20)
            }
        }

        assertTrue(vm.uiState.value is TaskListUiState.Error)
        assertEquals(1, sessionInvalidated)
    }

    private suspend fun awaitReady(vm: TaskListViewModel): TaskListUiState.Ready {
        withTimeout(3_000) {
            while (vm.uiState.value is TaskListUiState.Loading) {
                delay(20)
            }
        }
        return vm.uiState.value as TaskListUiState.Ready
    }
}
