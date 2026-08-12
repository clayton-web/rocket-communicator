package com.aicommunication.assistant.capture

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import java.time.Instant
import java.util.concurrent.TimeUnit
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

/**
 * Owner manual capture drives the shared interpretation route and shows proposals read-only
 * (S3.3b, D171).
 *
 * These tests run the real use case, repository, and pending store against MockWebServer, so the
 * assertions are about the requests actually sent and the retry identity actually persisted.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class TaskCaptureViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val requestAdapter = ownerApiMoshi().adapter(ManualCaptureRequestWire::class.java)

    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private lateinit var prefs: SharedPreferences
    private lateinit var pendingStore: PendingCaptureStore
    private var sessionInvalidated = 0

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        server = MockWebServer()
        server.start()
        prefs =
            application.getSharedPreferences(PendingCaptureStore.FILE_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        pendingStore = PendingCaptureStore.forTests(prefs)
        sessionInvalidated = 0
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    // --- Capture switch -------------------------------------------------------------------

    @Test
    fun save_sendsManualCaptureAndNeverDirectCreate() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer about the leak"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer about the leak")

        vm.save()
        vm.awaitSettled()

        assertEquals(1, server.requestCount)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/manual-captures", request.path)
        assertNotEquals("/api/v1/tasks", request.path)
        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
    }

    @Test
    fun save_skipsABlankDraftWithoutSendingAnything() = runTest {
        val vm = viewModel()
        vm.onDraftChanged("   ")

        vm.save()

        assertEquals(0, server.requestCount)
        assertTrue(vm.uiState.value is CaptureUiState.Editing)
        assertNull(pendingStore.read())
    }

    @Test
    fun legacyDirectCreateRemainsPresentButUnusedByCapture() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        assertEquals("/api/v1/manual-captures", server.takeRequest().path)

        // The legacy direct-create client still exists and still works when driven directly.
        // The Capture surface simply no longer reaches it.
        server.enqueue(
            MockResponse()
                .setResponseCode(201)
                .setBody("""{"id":"t1","etag":"e1","status":"active","summaryPoints":[]}""")
        )
        val legacy = CaptureTaskUseCase(TaskOwnerRepository(executor())).execute("Call the roofer")

        assertTrue(legacy is OwnerApiResult.Success)
        assertEquals("/api/v1/tasks", server.takeRequest().path)
    }

    // --- New capture ----------------------------------------------------------------------

    @Test
    fun save_persistsExactlyOneTupleAndSendsThatSameIdentity() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        // Submitting state is set before the request is launched; the tuple is already durable.
        val submitting = vm.uiState.value as CaptureUiState.Editing
        assertTrue(submitting.submitting)
        val persisted = requireNotNull(pendingStore.read())
        assertEquals("Call the roofer", persisted.rawInput)
        vm.awaitSettled()

        assertEquals(1, server.requestCount)
        val request = server.takeRequest()
        assertEquals(persisted.idempotencyKey, request.getHeader("Idempotency-Key"))
        val sent = requireNotNull(requestAdapter.fromJson(request.body.readUtf8()))
        assertEquals(persisted.capturedAt, sent.capturedAt)
        assertEquals(persisted.timezone, sent.timezone)
    }

    @Test
    fun save_clearsPendingOnlyAfterTheResultIsInPresentationState() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val statesWhenPendingCleared = mutableListOf<CaptureUiState>()
        var observed: TaskCaptureViewModel? = null
        val watched =
            ClearWatchingPreferences(prefs) {
                statesWhenPendingCleared += requireNotNull(observed).uiState.value
            }
        val vm = viewModel(store = PendingCaptureStore.forTests(watched))
        observed = vm
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        // The Owner can already see the result at the instant the retry identity is dropped, so a
        // crash between the two cannot lose a committed interpretation.
        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
        assertEquals(1, statesWhenPendingCleared.size)
        assertTrue(statesWhenPendingCleared.single() is CaptureUiState.Proposals)
        assertNull(pendingStore.read())
    }

    // --- Zero proposals -------------------------------------------------------------------

    @Test
    fun emptyProposalListIsTruthfulSuccessAndKeepsTheCaptureText() = runTest {
        enqueueSuccess()
        val vm = viewModel()
        vm.onDraftChanged("Thinking out loud")

        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertTrue(state.proposals.isEmpty())
        assertEquals("Thinking out loud", state.capturedText)
        assertNull(pendingStore.read())
    }

    @Test
    fun rephrase_reopensTheOriginalTextUnderNoPendingIdentity() = runTest {
        enqueueSuccess()
        val vm = viewModel()
        vm.onDraftChanged("Thinking out loud")
        vm.save()
        vm.awaitSettled()

        vm.rephrase()

        val state = vm.uiState.value as CaptureUiState.Editing
        assertEquals("Thinking out loud", state.draft)
        assertNull(pendingStore.read())
    }

    // --- Cardinality ----------------------------------------------------------------------

    @Test
    fun oneAndManyProposalsBothReachStateInServerOrder() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val single = viewModel()
        single.onDraftChanged("Call the roofer")
        single.save()
        single.awaitSettled()
        assertEquals(1, (single.uiState.value as CaptureUiState.Proposals).proposals.size)

        val ten = (1..10).map { index -> proposalJson("s$index", "Proposal $index") }
        enqueueSuccess(*ten.toTypedArray())
        val vm = viewModel()
        vm.onDraftChanged("A long capture holding ten separate pieces of work")
        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals(10, state.proposals.size)
        assertEquals((1..10).map { "s$it" }, state.proposals.map { it.id })
    }

    // --- Recovery -------------------------------------------------------------------------

    @Test
    fun restorePending_showsRecoveryAndNeverResends() = runTest {
        pendingStore.write(operation())
        val vm = viewModel()

        vm.restorePending()

        val state = vm.uiState.value as CaptureUiState.Recovery
        assertEquals("Call the roofer about the leak", state.rawInput)
        assertFalse(state.submitting)
        assertEquals(0, server.requestCount)
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
    }

    @Test
    fun restorePending_ignoresExpiredRecords() = runTest {
        val stale = Instant.now().minusMillis(PendingCaptureStore.TTL_MS + 1_000L).toString()
        pendingStore.write(operation(createdAt = stale))
        val vm = viewModel()

        vm.restorePending()

        assertTrue(vm.uiState.value is CaptureUiState.Editing)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun retry_replaysTheStoredTupleVerbatimAndRendersTheResult() = runTest {
        val stored = operation()
        pendingStore.write(stored)
        enqueueSuccess(proposalJson("s1", "Call the roofer about the leak"))
        val vm = viewModel()
        vm.restorePending()

        vm.retry()
        vm.awaitSettled()

        val request = server.takeRequest()
        assertEquals(stored.idempotencyKey, request.getHeader("Idempotency-Key"))
        val sent = requireNotNull(requestAdapter.fromJson(request.body.readUtf8()))
        assertEquals(stored.rawInput, sent.rawInput)
        assertEquals(stored.capturedAt, sent.capturedAt)
        assertEquals(stored.timezone, sent.timezone)
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals(listOf("s1"), state.proposals.map { it.id })
        assertEquals(stored.rawInput, state.capturedText)
    }

    @Test
    fun discard_clearsPendingAndReturnsToEditing() = runTest {
        pendingStore.write(operation())
        val vm = viewModel()
        vm.restorePending()

        vm.discard()

        assertEquals(CaptureUiState.Editing(), vm.uiState.value)
        assertNull(pendingStore.read())
        assertEquals(0, server.requestCount)
    }

    // --- Failure handling -------------------------------------------------------------------

    @Test
    fun connectivityFailure_preservesPendingAndOffersRetry() = runTest {
        val vm = viewModel(validated = false)
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Recovery
        assertEquals("Call the roofer", state.rawInput)
        assertTrue(state.connectivityIssue)
        assertNotNull(pendingStore.read())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun dependencyUnavailable_preservesPending() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Recovery
        assertEquals("Call the roofer", state.rawInput)
        assertTrue(state.errorMessage!!.isNotBlank())
        assertNotNull(pendingStore.read())
    }

    @Test
    fun validationFailure_clearsUnusablePendingAndAllowsAFreshEdit() = runTest {
        enqueueError(400, "VALIDATION_ERROR")
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Editing
        assertEquals("Call the roofer", state.draft)
        assertTrue(state.errorMessage!!.isNotBlank())
        assertNull(pendingStore.read())
    }

    @Test
    fun idempotencyConflict_clearsOldIdentityAndRequiresAFreshSave() = runTest {
        enqueueError(409, "IDEMPOTENCY_KEY_CONFLICT")
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        val conflicted = server.takeRequest().getHeader("Idempotency-Key")

        val editing = vm.uiState.value as CaptureUiState.Editing
        assertTrue(editing.errorMessage!!.isNotBlank())
        assertNull(pendingStore.read())

        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        vm.save()
        vm.awaitSettled()

        val replacement = server.takeRequest().getHeader("Idempotency-Key")
        assertNotEquals(conflicted, replacement)
        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
    }

    @Test
    fun unauthorized_notifiesSessionAndKeepsTheCaptureRecoverable() = runTest {
        val vm = viewModel(token = null)
        vm.onDraftChanged("Secret note")

        vm.save()
        vm.awaitSettled()

        assertEquals(1, sessionInvalidated)
        val state = vm.uiState.value as CaptureUiState.Recovery
        assertEquals("Secret note", state.rawInput)
        assertNotNull(pendingStore.read())
    }

    @Test
    fun failureNeverRetriesOnItsOwn() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        assertNotNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
        assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
        assertTrue(vm.uiState.value is CaptureUiState.Recovery)
    }

    // --- Edit after failure (D171) ------------------------------------------------------------

    @Test
    fun editingAfterFailure_dropsTheOldTupleAndSavesUnderAFreshIdentity() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        val abandoned = server.takeRequest()
        val abandonedKey = abandoned.getHeader("Idempotency-Key")
        val abandonedCapturedAt =
            requireNotNull(requestAdapter.fromJson(abandoned.body.readUtf8())).capturedAt
        assertNotNull(pendingStore.read())

        vm.onDraftChanged("Call the roofer and the plumber")

        assertNull(pendingStore.read())
        assertEquals(
            CaptureUiState.Editing(draft = "Call the roofer and the plumber"),
            vm.uiState.value
        )

        enqueueSuccess(proposalJson("s1", "Call the roofer and the plumber"))
        vm.save()
        vm.awaitSettled()

        val replacement = server.takeRequest()
        val sent = requireNotNull(requestAdapter.fromJson(replacement.body.readUtf8()))
        assertNotEquals(abandonedKey, replacement.getHeader("Idempotency-Key"))
        assertNotEquals(abandonedCapturedAt, sent.capturedAt)
        assertEquals("Call the roofer and the plumber", sent.rawInput)
        assertEquals(2, server.requestCount)
    }

    // --- Lifecycle and navigation ---------------------------------------------------------------

    @Test
    fun captureAnother_resetsToFreshEditingWithNoRetryIdentity() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()

        vm.captureAnother()

        assertEquals(CaptureUiState.Editing(), vm.uiState.value)
        assertNull(pendingStore.read())
    }

    @Test
    fun leavingCapture_clearsAResultButNeverAnUnresolvedCapture() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()

        vm.onLeaveCapture()
        assertEquals(CaptureUiState.Editing(), vm.uiState.value)

        pendingStore.write(operation())
        vm.restorePending()
        vm.onLeaveCapture()

        assertTrue(vm.uiState.value is CaptureUiState.Recovery)
        assertNotNull(pendingStore.read())
    }

    @Test
    fun successfulCaptureCallsNoTaskRouteAndExposesNoTaskIdentity() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        val paths = (0 until server.requestCount).map { server.takeRequest().path }
        assertEquals(listOf("/api/v1/manual-captures"), paths)
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals("pending", state.proposals.single().status)
    }

    // --- Privacy ----------------------------------------------------------------------------

    @Test
    fun pendingCaptureNeverExposesRawInputToLogging() = runTest {
        val vm = viewModel(validated = false)
        vm.onDraftChanged("Bank account 1234 for the roofer")

        vm.save()
        vm.awaitSettled()

        val stored = requireNotNull(pendingStore.read())
        assertFalse(stored.toString().contains("Bank account 1234"))
        assertTrue(stored.toString().contains("<redacted>"))
    }

    @Test
    fun proposalResultsAreNeverWrittenToDisk() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer about the leak"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer about the leak")

        vm.save()
        vm.awaitSettled()

        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
        assertTrue(prefs.all.isEmpty())
    }

    // --- Helpers ------------------------------------------------------------------------------

    /**
     * Waits for the launched submission to finish completely — not merely for the state to change,
     * because the pending record is deliberately cleared after the result reaches state.
     */
    private suspend fun TaskCaptureViewModel.awaitSettled(): CaptureUiState {
        viewModelScope.coroutineContext.job.children.toList().forEach { child -> child.join() }
        return uiState.value
    }

    private fun viewModel(
        validated: Boolean = true,
        token: String? = "access-token",
        store: PendingCaptureStore = pendingStore
    ): TaskCaptureViewModel = TaskCaptureViewModel(
        application = application,
        manualCapture =
        ManualCaptureUseCase(
            repository = ManualCaptureRepository(executor(validated, token)),
            pendingStore = store
        ),
        onSessionInvalidated = { sessionInvalidated += 1 }
    )

    private fun executor(validated: Boolean = true, token: String? = "access-token") =
        OwnerApiExecutor(
            apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
            httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
            tokenProvider =
            object : AccessTokenProvider {
                override suspend fun currentAccessToken(): String? = token
                override suspend fun refreshAccessToken(): String? = null
            },
            connectivity = FixedConnectivityMonitor(validated = validated)
        )

    private fun operation(
        rawInput: String = "Call the roofer about the leak",
        createdAt: String = Instant.now().toString()
    ) = PendingCaptureOperation(
        idempotencyKey = "capture-11111111-1111-1111-1111-111111111111",
        rawInput = rawInput,
        capturedAt = "2026-08-12T15:00:00.123Z",
        timezone = "America/Los_Angeles",
        createdAt = createdAt
    )

    private fun enqueueSuccess(vararg proposals: String) {
        server.enqueue(MockResponse().setResponseCode(200).setBody(successBody(*proposals)))
    }

    private fun enqueueError(status: Int, code: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(status)
                .setBody("""{"error":{"code":"$code","message":"nope","requestId":"req-1"}}""")
        )
    }

    private fun successBody(vararg proposals: String): String = """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-12T15:00:00.000Z",
          "taskSuggestions": [${proposals.joinToString(",")}]
        }
    """.trimIndent()

    private fun proposalJson(id: String, value: String): String = """
        {
          "id": "$id",
          "status": "pending",
          "version": 1,
          "etag": "etag-$id",
          "createdAt": "2026-08-12T15:00:00.000Z",
          "summaryPoints": [
            {
              "id": "sp-$id",
              "kind": "confirmed_fact",
              "label": "Captured",
              "order": 0,
              "value": "$value"
            }
          ]
        }
    """.trimIndent()

    /** Reports the exact moment the pending retry record is removed from storage. */
    private class ClearWatchingPreferences(
        private val delegate: SharedPreferences,
        private val onPendingCleared: () -> Unit
    ) : SharedPreferences by delegate {
        override fun edit(): SharedPreferences.Editor =
            WatchingEditor(delegate.edit(), onPendingCleared)
    }

    private class WatchingEditor(
        private val delegate: SharedPreferences.Editor,
        private val onPendingCleared: () -> Unit
    ) : SharedPreferences.Editor by delegate {
        private var removesPending = false

        override fun remove(key: String?): SharedPreferences.Editor {
            if (key == PendingCaptureStore.KEY) {
                removesPending = true
            }
            delegate.remove(key)
            return this
        }

        override fun apply() {
            delegate.apply()
            if (removesPending) {
                onPendingCleared()
            }
        }

        override fun commit(): Boolean {
            val committed = delegate.commit()
            if (removesPending) {
                onPendingCleared()
            }
            return committed
        }
    }
}
