package com.aicommunication.assistant.capture

import android.app.Application
import com.aicommunication.assistant.network.OwnerApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
class TaskCaptureViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var application: Application
    private var sessionInvalidated = 0

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        sessionInvalidated = 0
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun save_ignoresBlankDraft() = runTest {
        val useCase = FakeCaptureTaskUseCase(OwnerApiResult.Unexpected("should not run"))
        val vm = viewModel(useCase)

        vm.save()

        assertEquals(0, useCase.calls)
        assertTrue(vm.uiState.value is CaptureUiState.Editing)
    }

    @Test
    fun save_successRequiresServerResult() = runTest {
        val captured =
            CapturedTask(
                id = "t1",
                etag = "e1",
                status = "active",
                displayTitle = "Buy paint"
            )
        val useCase = FakeCaptureTaskUseCase(OwnerApiResult.Success(captured))
        val vm = viewModel(useCase)
        vm.onDraftChanged("Buy paint")

        vm.save()

        val state = vm.uiState.value as CaptureUiState.Captured
        assertEquals("t1", state.task.id)
        assertEquals(1, useCase.calls)
    }

    @Test
    fun save_preservesDraftOnConnectivityFailure() = runTest {
        val useCase = FakeCaptureTaskUseCase(OwnerApiResult.Connectivity)
        val vm = viewModel(useCase)
        vm.onDraftChanged("Keep this draft")

        vm.save()

        val state = vm.uiState.value as CaptureUiState.Editing
        assertEquals("Keep this draft", state.draft)
        assertFalse(state.submitting)
        assertTrue(state.connectivityIssue)
        assertTrue(state.errorMessage!!.isNotBlank())
    }

    @Test
    fun save_unauthorizedNotifiesSessionInvalidated() = runTest {
        val useCase = FakeCaptureTaskUseCase(OwnerApiResult.Unauthorized)
        val vm = viewModel(useCase)
        vm.onDraftChanged("Secret note")

        vm.save()

        assertEquals(1, sessionInvalidated)
        val state = vm.uiState.value as CaptureUiState.Editing
        assertEquals("Secret note", state.draft)
    }

    @Test
    fun captureAnother_resetsToEmptyEditing() = runTest {
        val captured =
            CapturedTask(
                id = "t1",
                etag = "e1",
                status = "active",
                displayTitle = "Done"
            )
        val useCase = FakeCaptureTaskUseCase(OwnerApiResult.Success(captured))
        val vm = viewModel(useCase)
        vm.onDraftChanged("Done")
        vm.save()

        vm.captureAnother()

        val state = vm.uiState.value as CaptureUiState.Editing
        assertEquals("", state.draft)
        assertFalse(state.submitting)
    }

    private fun viewModel(useCase: CaptureTaskUseCase): TaskCaptureViewModel = TaskCaptureViewModel(
        application = application,
        captureTask = useCase,
        onSessionInvalidated = { sessionInvalidated += 1 }
    )

    private class FakeCaptureTaskUseCase(
        private val result: OwnerApiResult<CapturedTask>
    ) : CaptureTaskUseCase(repository = unusedRepository()) {
        var calls = 0

        override suspend fun execute(rawText: String): OwnerApiResult<CapturedTask> {
            calls += 1
            return result
        }

        companion object {
            private fun unusedRepository(): TaskOwnerRepository {
                val executor =
                    com.aicommunication.assistant.network.OwnerApiExecutor(
                        apiConfig = com.aicommunication.assistant.network.ApiConfig(
                            "http://127.0.0.1"
                        ),
                        httpClient =
                        com.aicommunication.assistant.network.OwnerHttpClientFactory.create(
                            enableSafeLogging = false
                        ),
                        tokenProvider =
                        object : com.aicommunication.assistant.network.AccessTokenProvider {
                            override suspend fun currentAccessToken(): String? = null
                            override suspend fun refreshAccessToken(): String? = null
                        },
                        connectivity =
                        com.aicommunication.assistant.network.FixedConnectivityMonitor(
                            validated = true
                        )
                    )
                return TaskOwnerRepository(executor)
            }
        }
    }
}
