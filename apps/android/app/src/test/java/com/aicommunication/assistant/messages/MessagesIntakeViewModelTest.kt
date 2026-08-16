package com.aicommunication.assistant.messages

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.job
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
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
class MessagesIntakeViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private var sessionInvalidated = 0
    private val requestAdapter = ownerApiMoshi().adapter(MessagesReviewRequestWire::class.java)

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        sessionInvalidated = 0
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
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
        assertFalse(ready.canReview)
    }

    @Test
    fun ready_showsEligibleAndFilteredWithoutReviewSideEffects() {
        val store = storeWith(eligibleObservation(), otpObservation())
        val vm = viewModel(store = store, enabled = true)
        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertEquals(1, ready.eligible.size)
        assertEquals(1, ready.filtered.size)
        assertEquals(MessagesIneligibilityReason.OTP_OR_FINANCIAL, ready.filtered.single().reason)
        assertEquals(0, server.requestCount)
        assertNull(vm.openReviewResult.value)
    }

    @Test
    fun eligibleItem_exposesReviewWithRocketAfterSelect() {
        val vm = viewModel(store = storeWith(eligibleObservation()), enabled = true)
        val id = (vm.uiState.value as MessagesIntakeUiState.Ready).eligible.single().id
        assertFalse((vm.uiState.value as MessagesIntakeUiState.Ready).canReview)

        vm.select(id)

        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertTrue(ready.canReview)
        assertEquals(id, ready.selectedId)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun filteredItem_cannotInvokeReview() = runTest {
        val store = storeWith(otpObservation())
        val vm = viewModel(store = store, enabled = true)
        vm.select("otp")
        vm.reviewWithRocket()
        vm.awaitSettled()

        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertNull(ready.selectedId)
        assertFalse(ready.canReview)
        assertEquals(0, server.requestCount)
        assertNull(vm.openReviewResult.value)
    }

    @Test
    fun notificationArrivalAndSelect_sendNothing() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val probe = MessagesNotificationShapeProbe(enabled = false)
        MessagesNotificationIntake.handle(eligibleObservation(), store, probe)
        val vm = viewModel(store = store, enabled = true)
        vm.select(store.snapshot.value.eligible.single().id)

        assertEquals(0, server.requestCount)
        assertNull(vm.openReviewResult.value)
    }

    @Test
    fun reviewWithRocket_sendsOnlyContractedFieldsFromTheOriginalOccurrence() = runTest {
        enqueueReview(emptyReviewBody)
        val postedAtMs = 1_700_000_000_000L
        val vm = loadedAndSelected(eligibleObservation(postTimeMs = postedAtMs))

        vm.reviewWithRocket()
        vm.awaitSettled()

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/messages/reviews", sent.path)
        assertNotEquals("/api/v1/tasks", sent.path)
        assertTrue(sent.getHeader("Idempotency-Key")!!.startsWith("messages-review-"))
        val raw = sent.body.readUtf8()
        assertTrue(raw.contains("\"sourceOccurrenceId\""))
        assertTrue(raw.contains("\"selectedText\""))
        assertTrue(raw.contains("\"observedAt\""))
        assertFalse(raw.contains("\"organizationId\""))
        assertFalse(raw.contains("\"sourceKind\""))
        assertFalse(raw.contains("\"accountId\""))
        assertFalse(raw.contains("\"sender\""))
        assertFalse(raw.contains("fromAddress"))
        assertFalse(raw.contains("\"phone\""))
        assertFalse(raw.contains("\"title\""))
        assertFalse(raw.contains("\"conversationTitle\""))
        assertFalse(raw.contains("Ada"))
        assertFalse(raw.contains("keySegmentCount"))
        assertFalse(raw.contains("keyTagClass"))
        assertFalse(raw.contains("keyTagPresence"))
        assertFalse(raw.contains("keyTagLengthBucket"))
        assertFalse(raw.contains("keyPackageSegmentMatchesObservedPackage"))
        assertFalse(raw.contains("keyTagEqualsSenderDisplayValue"))
        assertFalse(raw.contains("keyTagEqualsTitleOrConversationTitle"))
        assertFalse(raw.contains("keyTagEqualsPlainTextBody"))

        val body = requireNotNull(requestAdapter.fromJson(raw))
        assertEquals(
            "0|${GoogleMessagesPackages.GOOGLE_MESSAGES}|1|null|0",
            body.sourceOccurrenceId
        )
        assertEquals("Can you call me tomorrow", body.selectedText)
        assertEquals(MessagesReviewObservedAt.fromPostedAtMs(postedAtMs), body.observedAt)
        assertEquals("2023-11-14T22:13:20Z", body.observedAt)

        val result = requireNotNull(vm.openReviewResult.value)
        assertTrue(result.proposals.isEmpty())
        assertEquals("Can you call me tomorrow", result.sourceText)
    }

    @Test
    fun reviewRetry_preservesObservedAtAndIdempotencyKey() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        enqueueReview(emptyReviewBody)
        val postedAtMs = 1_700_000_050_000L
        val vm = loadedAndSelected(eligibleObservation(postTimeMs = postedAtMs))

        vm.reviewWithRocket()
        vm.awaitSettled()
        val failed = vm.uiState.value as MessagesIntakeUiState.Ready
        assertTrue(failed.canRetryReview)
        assertNull(vm.openReviewResult.value)
        assertEquals(1, server.requestCount)

        vm.reviewWithRocket()
        vm.awaitSettled()

        val first = server.takeRequest()
        val retry = server.takeRequest()
        val firstBody = requireNotNull(requestAdapter.fromJson(first.body.readUtf8()))
        val retryBody = requireNotNull(requestAdapter.fromJson(retry.body.readUtf8()))
        assertEquals(first.getHeader("Idempotency-Key"), retry.getHeader("Idempotency-Key"))
        assertEquals(firstBody.observedAt, retryBody.observedAt)
        assertEquals(MessagesReviewObservedAt.fromPostedAtMs(postedAtMs), retryBody.observedAt)
        assertEquals(firstBody.sourceOccurrenceId, retryBody.sourceOccurrenceId)
        assertEquals(firstBody.selectedText, retryBody.selectedText)
        assertNotNull(vm.openReviewResult.value)
    }

    @Test
    fun exactReplay_isHandledAsSuccess() = runTest {
        enqueueReview(replayReviewBody)
        val vm = loadedAndSelected(eligibleObservation())

        vm.reviewWithRocket()
        vm.awaitSettled()

        val result = requireNotNull(vm.openReviewResult.value)
        assertEquals(1, result.proposals.size)
        assertEquals("sug-replay", result.proposals.single().id)
        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertFalse(ready.canRetryReview)
        assertFalse(ready.reviewing)
    }

    @Test
    fun zeroSuggestions_isTruthfulSuccessAndDoesNotCreateATask() = runTest {
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected(eligibleObservation())

        vm.reviewWithRocket()
        vm.awaitSettled()

        val result = requireNotNull(vm.openReviewResult.value)
        assertTrue(result.proposals.isEmpty())
        assertEquals("/api/v1/messages/reviews", server.takeRequest().path)
        assertEquals(1, server.requestCount)
        assertNull((vm.uiState.value as MessagesIntakeUiState.Ready).reviewError)
    }

    @Test
    fun multipleSuggestions_enterExistingProposalModel() = runTest {
        enqueueReview(multiProposalReviewBody)
        val vm = loadedAndSelected(eligibleObservation())

        vm.reviewWithRocket()
        vm.awaitSettled()

        val result = requireNotNull(vm.openReviewResult.value)
        assertEquals(listOf("sug-1", "sug-2"), result.proposals.map { it.id })
        assertEquals("pending", result.proposals.first().status)
    }

    @Test
    fun conflict409_failsClosedAndDoesNotRegenerateAKeyAutomatically() = runTest {
        enqueueError(409, "IDEMPOTENCY_KEY_CONFLICT")
        val vm = loadedAndSelected(eligibleObservation())

        vm.reviewWithRocket()
        vm.awaitSettled()

        val ready = vm.uiState.value as MessagesIntakeUiState.Ready
        assertFalse(ready.canRetryReview)
        assertFalse(ready.reviewing)
        assertNotNull(ready.reviewError)
        assertNull(vm.openReviewResult.value)
        assertEquals(1, server.requestCount)
        assertEquals("/api/v1/messages/reviews", server.takeRequest().path)
    }

    @Test
    fun listenerError_isSurfaced() {
        val store = MessagesLocalReviewStore()
        store.setListenerError(GoogleMessagesNotificationListenerService.LISTENER_ERROR)
        val ready =
            viewModel(store = store, enabled = true).uiState.value as MessagesIntakeUiState.Ready
        assertTrue(ready.listenerError)
    }

    @Test
    fun localStore_isNotADurableMessagesArchive() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        store.record(eligibleObservation(), MessagesEligibility.classify(eligibleObservation()))
        assertEquals(1, store.snapshot.value.eligible.size)
        val fieldNames = MessagesLocalReviewStore::class.java.declaredFields.map { it.name }
        assertFalse(fieldNames.any { it.contains("prefs", ignoreCase = true) })
        assertFalse(fieldNames.any { it.contains("file", ignoreCase = true) })
        assertFalse(fieldNames.any { it.contains("database", ignoreCase = true) })
    }

    private suspend fun loadedAndSelected(
        observation: MessagesNotificationObservation
    ): MessagesIntakeViewModel {
        val store = storeWith(observation)
        val vm = viewModel(store = store, enabled = true)
        vm.select(store.snapshot.value.eligible.single().id)
        return vm
    }

    private suspend fun MessagesIntakeViewModel.awaitSettled() {
        viewModelScope.coroutineContext.job.children.toList().forEach { child -> child.join() }
    }

    private fun viewModel(
        store: MessagesLocalReviewStore = MessagesLocalReviewStore(),
        enabled: Boolean = false,
        access: FakeMessagesNotificationAccess = FakeMessagesNotificationAccess(enabled)
    ) = MessagesIntakeViewModel(
        application = application,
        store = store,
        access = access,
        shapeProbe = MessagesNotificationShapeProbe(enabled = false),
        repository = MessagesOwnerRepository(executor()),
        onSessionInvalidated = { sessionInvalidated += 1 }
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

    private fun storeWith(vararg observations: MessagesNotificationObservation) =
        MessagesLocalReviewStore(clock = { 1_700_000_100_000L }).also { store ->
            observations.forEach { observation ->
                store.record(observation, MessagesEligibility.classify(observation))
            }
        }

    private fun eligibleObservation(
        postTimeMs: Long = 1_700_000_000_000L
    ): MessagesNotificationObservation = observation(postTimeMs = postTimeMs)

    private fun otpObservation(): MessagesNotificationObservation =
        observation(notificationKey = "otp", text = "Your verification code is 123456")

    private fun enqueueReview(body: String) {
        server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    }

    private fun enqueueError(status: Int, code: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(status)
                .setBody("""{"error":{"code":"$code","message":"nope","requestId":"req-1"}}""")
        )
    }

    private val emptyReviewBody =
        """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": []
        }
        """.trimIndent()

    private val replayReviewBody =
        """
        {
          "idempotentReplay": true,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": [
            {
              "id": "sug-replay",
              "status": "pending",
              "version": 1,
              "etag": "etag-replay",
              "createdAt": "2026-08-13T18:00:00.000Z",
              "summaryPoints": [
                {
                  "id": "sp-replay",
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

    private val multiProposalReviewBody =
        """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": [
            {
              "id": "sug-1",
              "status": "pending",
              "version": 1,
              "etag": "etag-1",
              "createdAt": "2026-08-13T18:00:00.000Z",
              "summaryPoints": [
                {"id":"p1","kind":"request","label":"Request","order":0,"value":"Call Ada"}
              ]
            },
            {
              "id": "sug-2",
              "status": "pending",
              "version": 1,
              "etag": "etag-2",
              "createdAt": "2026-08-13T18:00:00.000Z",
              "summaryPoints": [
                {"id":"p2","kind":"request","label":"Request","order":0,"value":"Send the quote"}
              ]
            }
          ]
        }
        """.trimIndent()
}
