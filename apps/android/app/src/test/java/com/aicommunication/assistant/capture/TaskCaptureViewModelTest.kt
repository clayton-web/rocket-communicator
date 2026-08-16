package com.aicommunication.assistant.capture

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.R
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import com.aicommunication.assistant.tasks.RecipientOwnerRepository
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
 * Owner manual capture drives the shared interpretation route (S3.3b, D171). Accept creates a
 * Task only after an explicit Owner decision; Edit and Dismiss do not (S5.3, D176).
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
    fun missingCaptureRoute_keepsTheCaptureVisibleAndSaysRetryingWillNotHelp() = runTest {
        // Reproduces the observed device failure: the deployment that answered has no capture
        // route, so its catch-all replies 404 with no Rocket error envelope.
        server.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setHeader("Content-Type", "text/html; charset=utf-8")
                .setBody("<!DOCTYPE html><html><body>404</body></html>")
        )
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer about the leak")

        vm.save()
        vm.awaitSettled()

        val state = vm.uiState.value as CaptureUiState.Recovery
        assertEquals("Call the roofer about the leak", state.rawInput)
        // The Owner sees why, not a bare status line, and the capture is still there.
        assertEquals(
            application.getString(R.string.capture_error_route_unavailable),
            state.errorMessage
        )
        assertFalse(state.connectivityIssue)
        assertNotNull(pendingStore.read())
    }

    @Test
    fun missingCaptureRoute_retriesTheSameLogicalCaptureAndCreatesNoSecondOne() = runTest {
        server.enqueue(MockResponse().setResponseCode(404))
        enqueueSuccess(proposalJson("s1", "Call the roofer about the leak"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer about the leak")
        vm.save()
        vm.awaitSettled()
        val frozen = requireNotNull(pendingStore.read())

        vm.retry()
        vm.awaitSettled()

        assertEquals(2, server.requestCount)
        val first = server.takeRequest()
        val second = server.takeRequest()
        assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
        assertEquals(frozen.idempotencyKey, second.getHeader("Idempotency-Key"))
        val replayed = requireNotNull(requestAdapter.fromJson(second.body.readUtf8()))
        assertEquals(frozen.capturedAt, replayed.capturedAt)
        // Compared without assertEquals so a failure never prints the capture text.
        assertTrue("rawInput must be replayed verbatim", frozen.rawInput == replayed.rawInput)
        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
    }

    @Test
    fun missingCaptureRoute_neverAutoRetriesTheMissingRoute() = runTest {
        server.enqueue(MockResponse().setResponseCode(404))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")

        vm.save()
        vm.awaitSettled()

        assertNotNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
        assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
        assertTrue(vm.uiState.value is CaptureUiState.Recovery)
    }

    @Test
    fun missingCaptureRoute_editingTheTextStartsANewCaptureAsTheCopyPromises() = runTest {
        server.enqueue(MockResponse().setResponseCode(404))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        val failed = requireNotNull(pendingStore.read())

        vm.onDraftChanged("Call the roofer about the leak instead")

        // The old identity must never carry changed text back to the server.
        assertTrue(vm.uiState.value is CaptureUiState.Editing)
        assertNull(pendingStore.read())

        enqueueSuccess(proposalJson("s1", "Call the roofer about the leak instead"))
        vm.save()
        vm.awaitSettled()

        assertEquals(2, server.requestCount)
        server.takeRequest()
        val fresh = server.takeRequest()
        assertEquals("/api/v1/manual-captures", fresh.path)
        assertNotEquals(failed.idempotencyKey, fresh.getHeader("Idempotency-Key"))
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
        assertNull(state.proposals.single().approvedTaskId)
        assertNull(vm.openApprovedTaskId.value)
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

    // --- Accept (S5.2) --------------------------------------------------------------------

    @Test
    fun openAccept_startsWithNoResponsibilitySelectedAndConfirmUnavailable() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()

        vm.openAccept("s1")
        vm.awaitSettled()

        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertEquals("s1", accept.proposalId)
        assertNull(accept.selectedResponsibility)
        assertFalse(accept.canConfirm)
    }

    @Test
    fun selectOwner_enablesConfirmWithoutInferringFromAnEmptyPicker() = runTest {
        val vm = capturedProposal()
        enqueueRecipients(itemsJson = "")

        vm.openAccept("s1")
        vm.awaitSettled()
        val before = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertTrue(before.recipients.isEmpty())
        assertNull(before.selectedResponsibility)
        assertFalse(before.canConfirm)

        vm.selectOwnerResponsibility()

        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertEquals(ProposalResponsibility.Owner, accept.selectedResponsibility)
        assertTrue(accept.canConfirm)
    }

    @Test
    fun selectRecipient_usesThatExactRecipientId() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()

        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectRecipientResponsibility("rec-1")

        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertEquals(ProposalResponsibility.Recipient("rec-1"), accept.selectedResponsibility)
        assertTrue(accept.canConfirm)
    }

    @Test
    fun recipientLoadingOccursOnlyAfterOpenAccept() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        assertEquals(1, server.requestCount)

        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()

        assertEquals(2, server.requestCount)
        server.takeRequest()
        assertEquals("/api/v1/recipients?limit=50", server.takeRequest().path)
    }

    @Test
    fun switchingAcceptClearsStaleResponsibilitySelection() = runTest {
        enqueueSuccess(
            proposalJson("s1", "Call the roofer"),
            proposalJson("s2", "Call the plumber")
        )
        val vm = viewModel()
        vm.onDraftChanged("Two jobs")
        vm.save()
        vm.awaitSettled()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueRecipients()

        vm.openAccept("s2")
        vm.awaitSettled()

        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertEquals("s2", accept.proposalId)
        assertNull(accept.selectedResponsibility)
        assertFalse(accept.canConfirm)
    }

    @Test
    fun cancelAcceptClearsResponsibilitySelection() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()

        vm.cancelAccept()

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.accept)
    }

    @Test
    fun captureAnotherClearsTransientAcceptState() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()

        vm.captureAnother()

        assertEquals(CaptureUiState.Editing(), vm.uiState.value)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun duplicateConfirmIsBlockedWhileApproveIsInFlight() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        server.enqueue(
            MockResponse()
                .setBodyDelay(250, TimeUnit.MILLISECONDS)
                .setResponseCode(200)
                .setBody(approveSuccessBody("s1", "task-1"))
        )

        vm.confirmAccept()
        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/approve") == true })
        assertEquals("task-1", vm.openApprovedTaskId.value)
    }

    @Test
    fun confirmOwner_sendsCurrentEtagAndOwnerResponsibilityThenOpensReturnedTask() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueApproveSuccess("s1", "task-9")

        vm.confirmAccept()
        vm.awaitSettled()

        val approve = takeRequestMatching { it?.endsWith("/s1/approve") == true }
        assertEquals("POST", approve.method)
        assertEquals("/api/v1/task-suggestions/s1/approve", approve.path)
        assertEquals("etag-s1", approve.getHeader("If-Match"))
        val raw = approve.body.readUtf8()
        val body =
            requireNotNull(
                ownerApiMoshi().adapter(ApproveProposalRequestWire::class.java).fromJson(raw)
            )
        assertEquals("owner", body.responsibility.responsibleParty)
        assertNull(body.responsibility.recipientId)
        assertFalse(raw.contains("\"recipientId\""))
        assertEquals("task-9", vm.openApprovedTaskId.value)
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.accept)
        assertEquals("approved", state.proposals.single().status)
    }

    @Test
    fun confirmRecipient_sendsRecipientResponsibilityVariant() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectRecipientResponsibility("rec-1")
        enqueueApproveSuccess("s1", "task-2")

        vm.confirmAccept()
        vm.awaitSettled()

        val raw = takeRequestMatching { it?.endsWith("/s1/approve") == true }.body.readUtf8()
        val body =
            requireNotNull(
                ownerApiMoshi().adapter(ApproveProposalRequestWire::class.java).fromJson(raw)
            )
        assertEquals("recipient", body.responsibility.responsibleParty)
        assertEquals("rec-1", body.responsibility.recipientId)
        assertEquals("task-2", vm.openApprovedTaskId.value)
    }

    @Test
    fun ambiguousApprove_rereadsOnceAndNavigatesWhenApprovedTaskIdIsPresent() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(412, "PRECONDITION_FAILED")
        enqueueSuggestion(
            id = "s1",
            status = "approved",
            etag = "etag-s1-v2",
            approvedTaskId = "task-7"
        )

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertEquals(1, paths.count { it?.endsWith("/approve") == true })
        assertEquals("task-7", vm.openApprovedTaskId.value)
    }

    @Test
    fun ambiguousApprove_rereadWithoutApprovedTaskIdDoesNotNavigateOrRetryApprove() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(409, "INVALID_STATE_TRANSITION")
        enqueueSuggestion(
            id = "s1",
            status = "pending",
            etag = "etag-s1-v2",
            approvedTaskId = null
        )

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/approve") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertNull(vm.openApprovedTaskId.value)
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals("etag-s1-v2", state.proposals.single().etag)
        val accept = requireNotNull(state.accept)
        assertNull(accept.selectedResponsibility)
        assertFalse(accept.canConfirm)
        assertNotNull(accept.message)
    }

    @Test
    fun laterManualAcceptUsesRefreshedEtag() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(412, "PRECONDITION_FAILED")
        enqueueSuggestion(
            id = "s1",
            status = "pending",
            etag = "fresh-etag",
            approvedTaskId = null
        )

        vm.confirmAccept()
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueApproveSuccess("s1", "task-3")

        vm.confirmAccept()
        vm.awaitSettled()

        takeRequestMatching { it?.endsWith("/s1/approve") == true }
        val retry = takeRequestMatching { it?.endsWith("/s1/approve") == true }
        assertEquals("fresh-etag", retry.getHeader("If-Match"))
        assertEquals("task-3", vm.openApprovedTaskId.value)
    }

    @Test
    fun reReadFailureDoesNotAutoRetryApprove() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/approve") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertNull(vm.openApprovedTaskId.value)
        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertTrue(accept.recoveryReadFailed)
        assertFalse(accept.canConfirm)
        assertNotNull(accept.message)
    }

    @Test
    fun validationErrorDoesNotClaimSuccessOrReread() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(400, "VALIDATION_ERROR")

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/approve") == true })
        assertEquals(0, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertNull(vm.openApprovedTaskId.value)
        val accept = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).accept)
        assertFalse(accept.recoveryReadFailed)
        assertNotNull(accept.message)
        val proposals = vm.uiState.value as CaptureUiState.Proposals
        assertEquals("etag-s1", proposals.proposals.single().etag)
    }

    @Test
    fun notFoundDoesNotClaimSuccessOrReread() = runTest {
        val vm = capturedProposal()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(404, "NOT_FOUND")

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(0, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun unauthorizedDoesNotRereadOrNavigate() = runTest {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()
        enqueueError(401, "UNAUTHORIZED")

        vm.confirmAccept()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(0, paths.count { it == "/api/v1/task-suggestions/s1" })
        assertNull(vm.openApprovedTaskId.value)
        assertEquals(1, sessionInvalidated)
    }

    // --- Edit (S5.3) ----------------------------------------------------------------------

    @Test
    fun openEdit_startsWithCanonicalOrderedWordingAndPreservesStructure() = runTest {
        enqueueSuccess(multiPointProposalJson())
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer by Friday")
        vm.save()
        vm.awaitSettled()

        vm.openEdit("s1")

        val state = vm.uiState.value as CaptureUiState.Proposals
        val edit = requireNotNull(state.edit)
        assertEquals("s1", edit.proposalId)
        assertEquals(listOf("sp-a", "sp-b", "sp-c"), edit.draftPoints.map { it.id })
        assertEquals(
            listOf("confirmed_fact", "next_action", "amount"),
            edit.draftPoints.map { it.kind }
        )
        assertEquals(listOf(0, 1, 2), edit.draftPoints.map { it.order })
        assertEquals("Call the roofer", edit.draftPoints[0].value)
        assertEquals("Get a quote", edit.draftPoints[1].value)
        assertNull(edit.draftPoints[2].value)
        assertEquals(500.0, edit.draftPoints[2].amount)
        assertEquals("USD", edit.draftPoints[2].currency)
        assertTrue(edit.canSave)
    }

    @Test
    fun updateEditPoint_changesTextOnly() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")

        vm.updateEditPoint("sp-s1", "Call the roofer this afternoon")

        val point =
            requireNotNull((vm.uiState.value as CaptureUiState.Proposals).edit)
                .draftPoints
                .single()
        assertEquals("Call the roofer this afternoon", point.value)
        assertEquals("sp-s1", point.id)
        assertEquals("confirmed_fact", point.kind)
        assertEquals("Captured", point.label)
        assertEquals(0, point.order)
        assertNull(point.amount)
        assertNull(point.currency)
        assertNull(point.missingItem)
        assertNull(point.confidence)
    }

    @Test
    fun saveEdit_skipsBlankWordingWithoutSending() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        vm.updateEditPoint("sp-s1", "   ")

        vm.saveEdit()
        vm.awaitSettled()

        assertEquals(1, server.requestCount)
        val edit = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).edit)
        assertFalse(edit.canSave)
        assertEquals("   ", edit.draftPoints.single().value)
    }

    @Test
    fun cancelEdit_discardsLocalDraftWithoutMutatingTheProposal() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        vm.updateEditPoint("sp-s1", "Call the plumber instead")

        vm.cancelEdit()

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.edit)
        assertEquals("Call the roofer", state.proposals.single().summaryPoints.single().value)
        assertEquals(1, server.requestCount)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun saveEdit_sendsCurrentEtagAndOnlyUpdatedSummaryPoints() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        vm.updateEditPoint("sp-s1", "Call the roofer this afternoon")
        enqueueEditSuccess("s1", "Call the roofer this afternoon")

        vm.saveEdit()
        vm.awaitSettled()

        val editRequest = takeRequestMatching { it?.endsWith("/s1/edit") == true }
        assertEquals("POST", editRequest.method)
        assertEquals("etag-s1", editRequest.getHeader("If-Match"))
        val raw = editRequest.body.readUtf8()
        val body =
            requireNotNull(
                ownerApiMoshi().adapter(EditProposalRequestWire::class.java).fromJson(raw)
            )
        val point = body.summaryPoints.single()
        assertEquals("sp-s1", point.id)
        assertEquals("confirmed_fact", point.kind)
        assertEquals(0, point.order)
        assertEquals("Call the roofer this afternoon", point.value)
        assertFalse(raw.contains("proposedRecipientId"))
        assertFalse(raw.contains("proposedDueAt"))
        assertFalse(raw.contains("proposedPriority"))
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.edit)
        assertEquals(2, state.proposals.single().version)
        assertEquals("etag-s1-v2", state.proposals.single().etag)
        assertEquals(
            "Call the roofer this afternoon",
            state.proposals.single().summaryPoints.single().value
        )
        assertNull(vm.openApprovedTaskId.value)
        assertTrue(prefs.all.isEmpty())
    }

    @Test
    fun duplicateSaveEditIsBlockedWhileMutationIsInFlight() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        server.enqueue(
            MockResponse()
                .setBodyDelay(250, TimeUnit.MILLISECONDS)
                .setResponseCode(200)
                .setBody(editSuccessBody("s1", "Call the roofer"))
        )

        vm.saveEdit()
        vm.saveEdit()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/edit") == true })
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun switchingActionClearsStaleEditDraftAndAcceptSelection() = runTest {
        enqueueSuccess(
            proposalJson("s1", "Call the roofer"),
            proposalJson("s2", "Call the plumber")
        )
        val vm = viewModel()
        vm.onDraftChanged("Two jobs")
        vm.save()
        vm.awaitSettled()
        enqueueRecipients()
        vm.openAccept("s1")
        vm.awaitSettled()
        vm.selectOwnerResponsibility()

        vm.openEdit("s1")
        vm.updateEditPoint("sp-s1", "Reworded")
        assertNull((vm.uiState.value as CaptureUiState.Proposals).accept)

        vm.openEdit("s2")

        val state = vm.uiState.value as CaptureUiState.Proposals
        val edit = requireNotNull(state.edit)
        assertEquals("s2", edit.proposalId)
        assertEquals("Call the plumber", edit.draftPoints.single().value)
        assertNull(state.accept)
        assertNull(state.dismiss)

        vm.openDismiss("s2")
        val afterDismiss = vm.uiState.value as CaptureUiState.Proposals
        assertNull(afterDismiss.edit)
        assertEquals("s2", afterDismiss.dismiss?.proposalId)
        assertNull(afterDismiss.accept)
    }

    @Test
    fun editConflict_rereadsOnceWithoutRetryingOrMergingTheDraft() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        vm.updateEditPoint("sp-s1", "Local draft wording")
        enqueueError(412, "PRECONDITION_FAILED")
        enqueueSuggestion(
            id = "s1",
            status = "pending",
            etag = "fresh-etag",
            approvedTaskId = null,
            value = "Server wording"
        )

        vm.saveEdit()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/edit") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.edit)
        assertEquals("fresh-etag", state.proposals.single().etag)
        assertEquals("Server wording", state.proposals.single().summaryPoints.single().value)
        assertNotNull(state.notice)
        assertNull(vm.openApprovedTaskId.value)

        vm.openEdit("s1")
        enqueueEditSuccess("s1", "Edited again")
        vm.saveEdit()
        vm.awaitSettled()
        val retry = takeRequestMatching { it?.endsWith("/s1/edit") == true }
        assertEquals("fresh-etag", retry.getHeader("If-Match"))
    }

    @Test
    fun saveEdit_mixedKindProposal_roundTripsCanonicalKindSpecificFields() = runTest {
        enqueueSuccess(mixedKindProposalJson())
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer about the 500 deposit")
        vm.save()
        vm.awaitSettled()
        vm.openEdit("s-mixed")
        vm.updateEditPoint("sp-request", "Call the roofer this afternoon")
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    mixedKindProposalJson(
                        requestValue = "Call the roofer this afternoon",
                        version = 2,
                        etag = "etag-s-mixed-v2"
                    )
                )
        )

        vm.saveEdit()
        vm.awaitSettled()

        val editRequest = takeRequestMatching { it?.endsWith("/s-mixed/edit") == true }
        assertEquals("POST", editRequest.method)
        assertEquals("etag-s-mixed", editRequest.getHeader("If-Match"))
        val raw = editRequest.body.readUtf8()
        val body =
            requireNotNull(
                ownerApiMoshi().adapter(EditProposalRequestWire::class.java).fromJson(raw)
            )
        assertEquals(5, body.summaryPoints.size)
        assertEquals(
            listOf("sp-request", "sp-amount", "sp-deadline", "sp-missing", "sp-inference"),
            body.summaryPoints.map { it.id }
        )
        assertEquals(
            listOf("request", "amount", "deadline", "missing_information", "inference"),
            body.summaryPoints.map { it.kind }
        )
        assertEquals(listOf(0, 1, 2, 3, 4), body.summaryPoints.map { it.order })

        val request = body.summaryPoints[0]
        assertEquals("Call the roofer this afternoon", request.value)
        assertEquals("Request", request.label)
        assertNull(request.amount)
        assertNull(request.currency)
        assertNull(request.missingItem)
        assertNull(request.confidence)

        val amount = body.summaryPoints[1]
        assertNull(amount.value)
        assertEquals(500.0, amount.amount)
        assertEquals("USD", amount.currency)
        assertNull(amount.dueAt)
        assertNull(amount.localDate)
        assertNull(amount.timezone)
        assertNull(amount.missingItem)
        assertNull(amount.confidence)

        val deadline = body.summaryPoints[2]
        assertNull(deadline.value)
        assertNull(deadline.dueAt)
        assertEquals("2026-08-20", deadline.localDate)
        assertEquals("America/Los_Angeles", deadline.timezone)
        assertNull(deadline.amount)
        assertNull(deadline.currency)
        assertNull(deadline.missingItem)

        val missing = body.summaryPoints[3]
        assertNull(missing.value)
        assertEquals("Property street address", missing.missingItem)
        assertNull(missing.amount)
        assertNull(missing.confidence)

        val inference = body.summaryPoints[4]
        assertEquals("Owner sounded urgent", inference.value)
        assertEquals(0.7, inference.confidence)
        assertNull(inference.amount)
        assertNull(inference.missingItem)

        assertFalse(raw.contains("proposedRecipientId"))
        assertFalse(raw.contains("proposedDueAt"))
        assertFalse(raw.contains("proposedPriority"))
        assertFalse(raw.contains("\"sensitivity\""))
        assertFalse(raw.contains("sourceSpanRef"))

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.edit)
        assertEquals(2, state.proposals.single().version)
        assertEquals("etag-s-mixed-v2", state.proposals.single().etag)
        assertEquals(
            "Call the roofer this afternoon",
            state.proposals.single().summaryPoints.first { it.id == "sp-request" }.value
        )
        assertEquals(500.0, state.proposals.single().summaryPoints[1].amount)
        assertNull(vm.openApprovedTaskId.value)
        assertTrue(prefs.all.isEmpty())
    }

    @Test
    fun editConflict_terminalCanonicalStateClearsTheActionSurface() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        enqueueError(409, "INVALID_STATE_TRANSITION")
        enqueueSuggestion(
            id = "s1",
            status = "approved",
            etag = "etag-s1-v2",
            approvedTaskId = "task-9"
        )

        vm.saveEdit()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/edit") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.edit)
        assertEquals("approved", state.proposals.single().status)
        assertNotNull(state.notice)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun editValidationErrorDoesNotRereadOrRetry() = runTest {
        val vm = capturedProposal()
        vm.openEdit("s1")
        enqueueError(400, "VALIDATION_ERROR")

        vm.saveEdit()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/edit") == true })
        assertEquals(0, paths.count { it == "/api/v1/task-suggestions/s1" })
        val edit = requireNotNull((vm.uiState.value as CaptureUiState.Proposals).edit)
        assertFalse(edit.saving)
        assertNotNull(edit.message)
        val proposals = (vm.uiState.value as CaptureUiState.Proposals).proposals
        assertEquals("etag-s1", proposals.single().etag)
    }

    // --- Dismiss (S5.3) -------------------------------------------------------------------

    @Test
    fun confirmDismiss_targetsThatProposalEtagAndRemovesItWithoutCreatingATask() = runTest {
        enqueueSuccess(
            proposalJson("s1", "Call the roofer"),
            proposalJson("s2", "Call the plumber")
        )
        val vm = viewModel()
        vm.onDraftChanged("Two jobs")
        vm.save()
        vm.awaitSettled()
        vm.openDismiss("s1")
        enqueueDismissSuccess("s1")

        vm.confirmDismiss()
        vm.awaitSettled()

        val dismissed = takeRequestMatching { it?.endsWith("/s1/dismiss") == true }
        assertEquals("POST", dismissed.method)
        assertEquals("etag-s1", dismissed.getHeader("If-Match"))
        assertEquals("{}", dismissed.body.readUtf8())
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals(listOf("s2"), state.proposals.map { it.id })
        assertNull(state.dismiss)
        assertNull(vm.openApprovedTaskId.value)
        assertTrue(prefs.all.isEmpty())
    }

    @Test
    fun duplicateDismissIsBlockedWhileMutationIsInFlight() = runTest {
        val vm = capturedProposal()
        vm.openDismiss("s1")
        server.enqueue(
            MockResponse()
                .setBodyDelay(250, TimeUnit.MILLISECONDS)
                .setResponseCode(200)
                .setBody(dismissSuccessBody("s1"))
        )

        vm.confirmDismiss()
        vm.confirmDismiss()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/dismiss") == true })
        assertTrue((vm.uiState.value as CaptureUiState.Proposals).proposals.isEmpty())
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun dismissConflict_rereadsOnceAndRequiresANewExplicitDismissWhenStillPending() = runTest {
        val vm = capturedProposal()
        vm.openDismiss("s1")
        enqueueError(412, "PRECONDITION_FAILED")
        enqueueSuggestion(
            id = "s1",
            status = "pending",
            etag = "fresh-etag",
            approvedTaskId = null
        )

        vm.confirmDismiss()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/dismiss") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.dismiss)
        assertEquals("fresh-etag", state.proposals.single().etag)
        assertNotNull(state.notice)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun dismissConflict_alreadyDismissedCanonicalStateRemovesTheProposal() = runTest {
        val vm = capturedProposal()
        vm.openDismiss("s1")
        enqueueError(409, "INVALID_STATE_TRANSITION")
        enqueueSuggestion(
            id = "s1",
            status = "dismissed",
            etag = "etag-s1-v2",
            approvedTaskId = null
        )

        vm.confirmDismiss()
        vm.awaitSettled()

        val paths = drainPaths()
        assertEquals(1, paths.count { it?.endsWith("/dismiss") == true })
        assertEquals(1, paths.count { it == "/api/v1/task-suggestions/s1" })
        val state = vm.uiState.value as CaptureUiState.Proposals
        assertTrue(state.proposals.isEmpty())
        assertNull(state.dismiss)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun cancelDismissDoesNotSendAMutation() = runTest {
        val vm = capturedProposal()
        vm.openDismiss("s1")

        vm.cancelDismiss()

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertNull(state.dismiss)
        assertEquals(1, state.proposals.size)
        assertEquals(1, server.requestCount)
        assertNull(vm.openApprovedTaskId.value)
    }

    // --- Gmail Review seam ----------------------------------------------------------------

    @Test
    fun presentGmailReview_hydratesExistingProposalSurfaceWithoutTouchingCaptureStore() = runTest {
        val vm = viewModel()
        val proposals =
            listOf(
                TaskSuggestionWire(
                    id = "sug-g1",
                    status = "pending",
                    summaryPoints =
                    listOf(
                        CaptureSummaryPointWire(
                            id = "p1",
                            kind = "request",
                            label = "Request",
                            order = 0,
                            value = "Send the revised quote"
                        )
                    ),
                    version = 1,
                    etag = "etag-g1",
                    createdAt = "2026-08-13T18:00:00.000Z"
                )
            )

        vm.presentGmailReview("Quote revision", proposals)

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals(ProposalOrigin.GmailReview, state.origin)
        assertEquals("Quote revision", state.capturedText)
        assertEquals(1, state.proposals.size)
        assertEquals("sug-g1", state.proposals.single().id)
        assertNull(pendingStore.read())
        assertEquals(0, server.requestCount)
        assertNull(vm.openApprovedTaskId.value)
    }

    @Test
    fun presentGmailReview_zeroSuggestionsIsTruthfulSuccess() = runTest {
        val vm = viewModel()

        vm.presentGmailReview("Thinking out loud", emptyList())

        val state = vm.uiState.value as CaptureUiState.Proposals
        assertEquals(ProposalOrigin.GmailReview, state.origin)
        assertTrue(state.proposals.isEmpty())
        assertEquals("Thinking out loud", state.capturedText)
        assertNull(pendingStore.read())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun presentGmailReview_doesNotCreateATaskAndLeavesRephraseClosed() = runTest {
        val vm = viewModel()
        vm.presentGmailReview("Quote revision", emptyList())

        vm.rephrase()
        vm.captureAnother()

        assertTrue(vm.uiState.value is CaptureUiState.Proposals)
        assertEquals(0, server.requestCount)
        assertNull(vm.openApprovedTaskId.value)
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
    ): TaskCaptureViewModel {
        val executor = executor(validated, token)
        return TaskCaptureViewModel(
            application = application,
            manualCapture =
            ManualCaptureUseCase(
                repository = ManualCaptureRepository(executor),
                pendingStore = store
            ),
            proposalRepository = ProposalOwnerRepository(executor),
            recipientRepository = RecipientOwnerRepository(executor),
            onSessionInvalidated = { sessionInvalidated += 1 }
        )
    }

    private suspend fun capturedProposal(): TaskCaptureViewModel {
        enqueueSuccess(proposalJson("s1", "Call the roofer"))
        val vm = viewModel()
        vm.onDraftChanged("Call the roofer")
        vm.save()
        vm.awaitSettled()
        return vm
    }

    private fun drainPaths(): List<String?> {
        val paths = mutableListOf<String?>()
        repeat(server.requestCount) { paths += server.takeRequest().path }
        return paths
    }

    private fun takeRequestMatching(
        predicate: (String?) -> Boolean
    ): okhttp3.mockwebserver.RecordedRequest {
        while (true) {
            val request = server.takeRequest()
            if (predicate(request.path)) {
                return request
            }
        }
    }

    private fun enqueueRecipients(
        itemsJson: String =
            """{"id":"rec-1","displayName":"Worker","email":"worker@example.com","active":true}"""
    ) {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"items":[$itemsJson],"nextCursor":null}""")
        )
    }

    private fun enqueueApproveSuccess(suggestionId: String, taskId: String) {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(approveSuccessBody(suggestionId, taskId))
        )
    }

    private fun enqueueSuggestion(
        id: String,
        status: String,
        etag: String,
        approvedTaskId: String?,
        value: String = "Call the roofer"
    ) {
        val approved = if (approvedTaskId == null) "null" else "\"$approvedTaskId\""
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "$id",
                      "status": "$status",
                      "version": 2,
                      "etag": "$etag",
                      "createdAt": "2026-08-12T15:00:00.000Z",
                      "summaryPoints": [
                        {
                          "id": "sp-$id",
                          "kind": "confirmed_fact",
                          "label": "Captured",
                          "order": 0,
                          "value": "$value"
                        }
                      ],
                      "approvedTaskId": $approved
                    }
                    """.trimIndent()
                )
        )
    }

    private fun enqueueEditSuccess(suggestionId: String, value: String) {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(editSuccessBody(suggestionId, value))
        )
    }

    private fun enqueueDismissSuccess(suggestionId: String) {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(dismissSuccessBody(suggestionId))
        )
    }

    private fun editSuccessBody(suggestionId: String, value: String): String = """
        {
          "id": "$suggestionId",
          "status": "pending",
          "version": 2,
          "etag": "etag-$suggestionId-v2",
          "createdAt": "2026-08-12T15:00:00.000Z",
          "summaryPoints": [
            {
              "id": "sp-$suggestionId",
              "kind": "confirmed_fact",
              "label": "Captured",
              "order": 0,
              "value": "$value"
            }
          ]
        }
    """.trimIndent()

    private fun dismissSuccessBody(suggestionId: String): String = """
        {
          "id": "$suggestionId",
          "status": "dismissed",
          "version": 2,
          "etag": "etag-$suggestionId-v2",
          "createdAt": "2026-08-12T15:00:00.000Z",
          "summaryPoints": [
            {
              "id": "sp-$suggestionId",
              "kind": "confirmed_fact",
              "label": "Captured",
              "order": 0,
              "value": "Call the roofer"
            }
          ]
        }
    """.trimIndent()

    private fun multiPointProposalJson(): String = """
        {
          "id": "s1",
          "status": "pending",
          "version": 1,
          "etag": "etag-s1",
          "createdAt": "2026-08-12T15:00:00.000Z",
          "summaryPoints": [
            {
              "id": "sp-a",
              "kind": "confirmed_fact",
              "label": "Captured",
              "order": 0,
              "value": "Call the roofer"
            },
            {
              "id": "sp-b",
              "kind": "next_action",
              "label": "Next",
              "order": 1,
              "value": "Get a quote"
            },
            {
              "id": "sp-c",
              "kind": "amount",
              "label": "Amount",
              "order": 2,
              "amount": 500,
              "currency": "USD"
            }
          ]
        }
    """.trimIndent()

    private fun approveSuccessBody(suggestionId: String, taskId: String): String {
        val suggestion =
            """
            {
              "id": "$suggestionId",
              "status": "approved",
              "version": 2,
              "etag": "etag-$suggestionId-v2",
              "createdAt": "2026-08-12T15:00:00.000Z",
              "summaryPoints": [
                {
                  "id": "sp-$suggestionId",
                  "kind": "confirmed_fact",
                  "label": "Captured",
                  "order": 0,
                  "value": "Call the roofer"
                }
              ],
              "approvedTaskId": "$taskId"
            }
            """.trimIndent()
        val task =
            """
            {
              "id": "$taskId",
              "etag": "task-$taskId-v1",
              "status": "open",
              "version": 1,
              "summaryPoints": [
                {
                  "id": "sp-$suggestionId",
                  "kind": "confirmed_fact",
                  "label": "Captured",
                  "order": 0,
                  "value": "Call the roofer"
                }
              ]
            }
            """.trimIndent()
        return """{"suggestion":$suggestion,"task":$task}"""
    }

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

    private fun mixedKindProposalJson(
        requestValue: String = "Call the roofer",
        version: Int = 1,
        etag: String = "etag-s-mixed"
    ): String = """
        {
          "id": "s-mixed",
          "status": "pending",
          "version": $version,
          "etag": "$etag",
          "createdAt": "2026-08-12T15:00:00.000Z",
          "summaryPoints": [
            {
              "id": "sp-request",
              "kind": "request",
              "label": "Request",
              "order": 0,
              "value": "$requestValue"
            },
            {
              "id": "sp-amount",
              "kind": "amount",
              "label": "Deposit",
              "order": 1,
              "amount": 500,
              "currency": "USD"
            },
            {
              "id": "sp-deadline",
              "kind": "deadline",
              "label": "Inspection deadline",
              "order": 2,
              "localDate": "2026-08-20",
              "timezone": "America/Los_Angeles"
            },
            {
              "id": "sp-missing",
              "kind": "missing_information",
              "label": "Missing address",
              "order": 3,
              "missingItem": "Property street address"
            },
            {
              "id": "sp-inference",
              "kind": "inference",
              "label": "Likely urgent",
              "order": 4,
              "value": "Owner sounded urgent",
              "confidence": 0.7
            }
          ]
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
