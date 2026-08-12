package com.aicommunication.assistant.capture

import android.app.Application
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.ConnectivityMonitor
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
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

/**
 * Frozen retry identity and pending lifecycle for Owner manual capture (S3.3, D171).
 *
 * The foundation is deliberately unreachable from the capture UI in this slice; these tests drive
 * it directly.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class ManualCaptureUseCaseTest {
    private lateinit var server: MockWebServer
    private lateinit var pendingStore: PendingCaptureStore
    private lateinit var useCase: ManualCaptureUseCase

    private val requestAdapter = ownerApiMoshi().adapter(ManualCaptureRequestWire::class.java)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        pendingStore = PendingCaptureStore(RuntimeEnvironment.getApplication())
        pendingStore.clear()
        useCase = useCase(FixedConnectivityMonitor(validated = true))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun useCase(connectivity: ConnectivityMonitor) = ManualCaptureUseCase(
        repository =
        ManualCaptureRepository(
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String? = "access-token"
                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = connectivity
            )
        ),
        pendingStore = pendingStore
    )

    private fun successBody(replay: Boolean = false, suggestionId: String? = null): String {
        val suggestions =
            if (suggestionId == null) {
                ""
            } else {
                """
                {
                  "id": "$suggestionId",
                  "organizationId": "org-1",
                  "status": "pending",
                  "summaryPoints": [
                    {"id":"p1","kind":"next_action","label":"Next","order":0,
                     "value":"Call the roofer"}
                  ],
                  "version": 1,
                  "etag": "\"task-suggestion-$suggestionId-v1\"",
                  "createdAt": "2026-08-12T15:04:05.123Z",
                  "updatedAt": "2026-08-12T15:04:05.123Z"
                }
                """.trimIndent()
            }
        return """
            {
              "idempotentReplay": $replay,
              "interpretedAt": "2026-08-12T15:04:05.200Z",
              "taskSuggestions": [$suggestions]
            }
        """.trimIndent()
    }

    private fun enqueueError(status: Int, code: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(status)
                .setBody("""{"error":{"code":"$code","message":"nope","requestId":"req-1"}}""")
        )
    }

    private fun RecordedRequest.tuple(): ManualCaptureRequestWire =
        requireNotNull(requestAdapter.fromJson(body.readUtf8()))

    @Test
    fun beginCaptureFreezesTheTupleAndPersistsItBeforeAnyRequest() {
        val operation = requireNotNull(useCase.beginCapture("  Call the roofer about the leak  "))

        assertEquals(0, server.requestCount)
        val stored = requireNotNull(pendingStore.read())
        assertEquals(operation.idempotencyKey, stored.idempotencyKey)
        assertEquals("Call the roofer about the leak", stored.rawInput)
        assertEquals(operation.capturedAt, stored.capturedAt)
        assertEquals(operation.timezone, stored.timezone)
    }

    @Test
    fun beginCaptureGeneratesOneContractLegalIdempotencyKey() {
        val operation = requireNotNull(useCase.beginCapture("Call the roofer"))

        assertTrue(operation.idempotencyKey.startsWith("capture-"))
        assertTrue(operation.idempotencyKey.length in 8..128)
        assertTrue(Regex("^[A-Za-z0-9._~-]+$").matches(operation.idempotencyKey))
        // A second capture is a different semantic request and gets its own identity.
        val other = requireNotNull(useCase.beginCapture("Order the lumber"))
        assertFalse(operation.idempotencyKey == other.idempotencyKey)
    }

    @Test
    fun beginCaptureRecordsAnExplicitInstantAndTheDeviceTimezone() {
        val operation = requireNotNull(useCase.beginCapture("Call the roofer"))

        // Parses as an absolute instant: no zone-less timestamp can reach the server.
        assertNotNull(Instant.parse(operation.capturedAt))
        assertTrue(operation.capturedAt.endsWith("Z"))
        assertEquals(ZoneId.systemDefault().id, operation.timezone)
    }

    @Test
    fun aBlankDraftIsNotACapture() {
        assertNull(useCase.beginCapture("   "))
        assertNull(pendingStore.read())
    }

    @Test
    fun submitSendsThePersistedTupleToTheManualCaptureRoute() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(successBody()))
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.submit(operation)

        assertEquals(1, server.requestCount)
        val sent = server.takeRequest()
        assertEquals("/api/v1/manual-captures", sent.path)
        assertEquals(operation.idempotencyKey, sent.getHeader("Idempotency-Key"))
        val body = sent.tuple()
        assertEquals(operation.rawInput, body.rawInput)
        assertEquals(operation.capturedAt, body.capturedAt)
        assertEquals(operation.timezone, body.timezone)
    }

    @Test
    fun retryResendsTheIdenticalTupleAndNoFieldIsRegenerated() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        server.enqueue(MockResponse().setResponseCode(200).setBody(successBody(replay = true)))
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.submit(operation)
        val retryOperation = requireNotNull(useCase.pendingCapture())
        val replay = useCase.submit(retryOperation) as OwnerApiResult.Success

        val first = server.takeRequest()
        val second = server.takeRequest()
        val firstTuple = first.tuple()
        val secondTuple = second.tuple()
        assertEquals(first.getHeader("Idempotency-Key"), second.getHeader("Idempotency-Key"))
        assertEquals(operation.idempotencyKey, second.getHeader("Idempotency-Key"))
        assertEquals(firstTuple.capturedAt, secondTuple.capturedAt)
        assertEquals(firstTuple.timezone, secondTuple.timezone)
        assertEquals(operation.capturedAt, secondTuple.capturedAt)
        assertEquals(operation.timezone, secondTuple.timezone)
        // Compared without assertEquals so a failure never prints the capture text.
        assertTrue("rawInput must be resent verbatim", operation.rawInput == secondTuple.rawInput)
        assertTrue("rawInput must not change", firstTuple.rawInput == secondTuple.rawInput)
        // A replay is an ordinary success to the caller.
        assertTrue(replay.value.idempotentReplay)
    }

    @Test
    fun dependencyUnavailableKeepsThePendingCaptureUnchanged() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        val result = useCase.submit(operation)

        assertEquals(
            ManualCaptureOutcome.DEPENDENCY_UNAVAILABLE,
            ManualCaptureOutcome.classify(result)
        )
        assertEquals(operation, useCase.pendingCapture())
    }

    @Test
    fun lostConnectivityKeepsThePendingCapture() = runTest {
        val offline = useCase(FixedConnectivityMonitor(validated = false))
        val operation = requireNotNull(offline.beginCapture("Call the roofer about the leak"))

        val result = offline.submit(operation)

        assertEquals(OwnerApiResult.Connectivity, result)
        assertEquals(0, server.requestCount)
        assertEquals(operation, offline.pendingCapture())
    }

    @Test
    fun ambiguousTransportFailureKeepsThePendingCapture() = runTest {
        server.enqueue(
            MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
        )
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        val result = useCase.submit(operation)

        // The request may have been interpreted server-side, so the tuple must survive.
        assertEquals(OwnerApiResult.Connectivity, result)
        assertEquals(operation, useCase.pendingCapture())
    }

    @Test
    fun unauthorizedKeepsThePendingCapture() = runTest {
        enqueueError(401, "UNAUTHORIZED")
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        val result = useCase.submit(operation)

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(operation, useCase.pendingCapture())
    }

    @Test
    fun validationFailureClearsThePendingCapture() = runTest {
        enqueueError(400, "VALIDATION_ERROR")
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.submit(operation)

        assertNull(useCase.pendingCapture())
    }

    @Test
    fun idempotencyConflictClearsThePendingCapture() = runTest {
        enqueueError(409, "IDEMPOTENCY_KEY_CONFLICT")
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.submit(operation)

        assertNull(useCase.pendingCapture())
    }

    @Test
    fun successKeepsThePendingCaptureUntilTheResultIsRepresented() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(successBody(suggestionId = "sug-1"))
        )
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        val result = useCase.submit(operation) as OwnerApiResult.Success

        assertEquals("sug-1", result.value.taskSuggestions.single().id)
        assertNotNull(useCase.pendingCapture())
        useCase.discardPending()
        assertNull(useCase.pendingCapture())
    }

    @Test
    fun anExplicitDiscardDropsThePendingCapture() {
        requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.discardPending()

        assertNull(useCase.pendingCapture())
    }

    @Test
    fun anExpiredPendingCaptureIsNoPendingCapture() {
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))
        val expired =
            operation.copy(
                createdAt =
                Instant.parse(operation.createdAt)
                    .minusMillis(PendingCaptureStore.TTL_MS + 1)
                    .toString()
            )
        pendingStore.write(expired)

        assertNull(useCase.pendingCapture())
    }

    @Test
    fun theFoundationNeverCreatesATaskDirectly() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(successBody()))
        val operation = requireNotNull(useCase.beginCapture("Call the roofer about the leak"))

        useCase.submit(operation)

        assertEquals(1, server.requestCount)
        assertEquals("/api/v1/manual-captures", server.takeRequest().path)
    }
}
