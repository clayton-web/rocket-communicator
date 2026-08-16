package com.aicommunication.assistant.messages

import android.app.Application
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class MessagesIntakeDoesNotUseNetworkTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    @Test
    fun notificationArrivalAndSelect_doNotCallTheServer() = runTest {
        val executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String? = "access-token"
                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val probe = MessagesNotificationShapeProbe(enabled = true)
        MessagesNotificationIntake.handle(observation(), store, probe)
        val vm =
            MessagesIntakeViewModel(
                application = RuntimeEnvironment.getApplication(),
                store = store,
                access = FakeMessagesNotificationAccess(enabled = true),
                shapeProbe = probe,
                repository = MessagesOwnerRepository(executor),
                onSessionInvalidated = {}
            )
        vm.refreshAccess()
        vm.select(store.snapshot.value.eligible.single().id)

        assertEquals(0, server.requestCount)
        assertEquals(null, vm.openReviewResult.value)
    }
}
