package com.aicommunication.assistant.messages

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
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
class MessagesIntakeViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun accessDisabled_isTheTruthfulState() {
        val vm = viewModel(enabled = false)
        assertEquals(MessagesIntakeUiState.AccessDisabled, vm.uiState.value)
    }

    @Test
    fun refreshAccess_movesToEmptyReadyWhenEnabled() {
        val access = FakeMessagesNotificationAccess(enabled = false)
        val vm = viewModel(access = access)
        access.enabled = true
        vm.refreshAccess()
        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertTrue(ready.eligible.isEmpty())
        assertTrue(ready.filtered.isEmpty())
    }

    @Test
    fun ready_showsEligibleAndFilteredWithoutReviewSideEffects() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val eligible = observation()
        val otp = observation(notificationKey = "otp", text = "Your verification code is 123456")
        store.record(eligible, MessagesEligibility.classify(eligible))
        store.record(otp, MessagesEligibility.classify(otp))
        val vm = viewModel(store = store, enabled = true)
        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertEquals(1, ready.eligible.size)
        assertEquals(1, ready.filtered.size)
        assertEquals(MessagesIneligibilityReason.OTP_OR_FINANCIAL, ready.filtered.single().reason)
    }

    @Test
    fun listenerError_isSurfaced() {
        val store = MessagesLocalReviewStore()
        store.setListenerError(GoogleMessagesNotificationListenerService.LISTENER_ERROR)
        val ready =
            viewModel(store = store, enabled = true).uiState.value as MessagesIntakeUiState.Ready
        assertTrue(ready.listenerError)
    }

    private fun viewModel(
        store: MessagesLocalReviewStore = MessagesLocalReviewStore(),
        enabled: Boolean = false,
        access: FakeMessagesNotificationAccess = FakeMessagesNotificationAccess(enabled)
    ) = MessagesIntakeViewModel(
        application = RuntimeEnvironment.getApplication(),
        store = store,
        access = access,
        shapeProbe = MessagesNotificationShapeProbe(enabled = false)
    )
}
