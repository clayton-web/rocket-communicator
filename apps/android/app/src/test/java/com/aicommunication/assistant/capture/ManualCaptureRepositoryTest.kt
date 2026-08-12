package com.aicommunication.assistant.capture

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * `POST /api/v1/manual-captures` through the shared A9.1 networking stack (S3.3, D171).
 */
class ManualCaptureRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: ManualCaptureRepository

    private val requestAdapter = ownerApiMoshi().adapter(ManualCaptureRequestWire::class.java)

    private val request =
        ManualCaptureRequestWire(
            rawInput = "Call the roofer about the leak",
            capturedAt = "2026-08-12T15:04:05.123Z",
            timezone = "America/Los_Angeles"
        )

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository = ManualCaptureRepository(executor(token = "access-token"))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun executor(token: String?) = OwnerApiExecutor(
        apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
        httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
        tokenProvider =
        object : AccessTokenProvider {
            override suspend fun currentAccessToken(): String? = token
            override suspend fun refreshAccessToken(): String? = null
        },
        connectivity = FixedConnectivityMonitor(validated = true)
    )

    private fun enqueueSuccess(body: String) {
        server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    }

    private fun enqueueError(status: Int, code: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(status)
                .setBody("""{"error":{"code":"$code","message":"nope","requestId":"req-1"}}""")
        )
    }

    private val emptySuccessBody =
        """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-12T15:04:05.200Z",
          "taskSuggestions": []
        }
        """.trimIndent()

    @Test
    fun sendsIdempotencyKeyJsonContentTypeAndTheExactTuple() = runTest {
        enqueueSuccess(emptySuccessBody)

        repository.createManualCapture("capture-key-1", request)

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/manual-captures", sent.path)
        assertEquals("capture-key-1", sent.getHeader("Idempotency-Key"))
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))

        val body = requireNotNull(requestAdapter.fromJson(sent.body.readUtf8()))
        assertEquals(request.rawInput, body.rawInput)
        assertEquals(request.capturedAt, body.capturedAt)
        assertEquals(request.timezone, body.timezone)
    }

    @Test
    fun sendsNoOrganizationOrSourceKind() = runTest {
        enqueueSuccess(emptySuccessBody)

        repository.createManualCapture("capture-key-1", request)

        val body = server.takeRequest().body.readUtf8()
        assertFalse(body.contains("organizationId"))
        assertFalse(body.contains("sourceKind"))
    }

    @Test
    fun reusesTheSharedBearerAuthentication() = runTest {
        enqueueSuccess(emptySuccessBody)

        repository.createManualCapture("capture-key-1", request)

        assertEquals("Bearer access-token", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun withoutASessionTheRequestIsNeverSent() = runTest {
        val unauthenticated = ManualCaptureRepository(executor(token = null))

        val result = unauthenticated.createManualCapture("capture-key-1", request)

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun parsesZeroProposalSuccess() = runTest {
        enqueueSuccess(emptySuccessBody)

        val result =
            repository.createManualCapture("capture-key-1", request)
                as OwnerApiResult.Success

        assertTrue(result.value.taskSuggestions.isEmpty())
        assertFalse(result.value.idempotentReplay)
    }

    @Test
    fun parsesProposalsAndReplayFlag() = runTest {
        enqueueSuccess(
            """
            {
              "idempotentReplay": true,
              "interpretedAt": "2026-08-12T15:04:05.200Z",
              "taskSuggestions": [
                {
                  "id": "sug-1",
                  "organizationId": "org-1",
                  "status": "pending",
                  "summaryPoints": [
                    {"id":"p1","kind":"next_action","label":"Next","order":0,
                     "value":"Call the roofer"}
                  ],
                  "version": 1,
                  "etag": "\"task-suggestion-sug-1-v1\"",
                  "createdAt": "2026-08-12T15:04:05.123Z",
                  "updatedAt": "2026-08-12T15:04:05.123Z"
                }
              ]
            }
            """.trimIndent()
        )

        val result =
            repository.createManualCapture("capture-key-1", request)
                as OwnerApiResult.Success

        assertTrue(result.value.idempotentReplay)
        val proposal = result.value.taskSuggestions.single()
        assertEquals("sug-1", proposal.id)
        assertEquals("Call the roofer", proposal.summaryPoints.single().value)
    }

    @Test
    fun validationFailureSurfacesAsAClassifiableHttpError() = runTest {
        enqueueError(400, "VALIDATION_ERROR")

        val result = repository.createManualCapture("capture-key-1", request)

        val error = result as OwnerApiResult.HttpError
        assertEquals(400, error.httpStatus)
        assertEquals(ErrorCode.VALIDATION_ERROR, error.code)
        assertEquals(ManualCaptureOutcome.VALIDATION_FAILURE, ManualCaptureOutcome.classify(result))
    }

    @Test
    fun idempotencyConflictSurfacesAsAClassifiableHttpError() = runTest {
        enqueueError(409, "IDEMPOTENCY_KEY_CONFLICT")

        val result = repository.createManualCapture("capture-key-1", request)

        val error = result as OwnerApiResult.HttpError
        assertEquals(409, error.httpStatus)
        assertEquals(ErrorCode.IDEMPOTENCY_KEY_CONFLICT, error.code)
        assertEquals(
            ManualCaptureOutcome.IDEMPOTENCY_CONFLICT,
            ManualCaptureOutcome.classify(result)
        )
    }

    @Test
    fun dependencyUnavailableSurfacesAsAClassifiableHttpError() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")

        val result = repository.createManualCapture("capture-key-1", request)

        val error = result as OwnerApiResult.HttpError
        assertEquals(503, error.httpStatus)
        assertEquals(ErrorCode.DEPENDENCY_UNAVAILABLE, error.code)
        assertEquals(
            ManualCaptureOutcome.DEPENDENCY_UNAVAILABLE,
            ManualCaptureOutcome.classify(result)
        )
    }

    @Test
    fun anUnparseableSuccessBodyIsNotReportedAsSuccess() = runTest {
        enqueueSuccess("""{"interpretedAt":"2026-08-12T15:04:05.200Z"}""")

        val result = repository.createManualCapture("capture-key-1", request)

        assertTrue(result is OwnerApiResult.Unexpected)
        assertEquals(ManualCaptureOutcome.UNEXPECTED, ManualCaptureOutcome.classify(result))
    }
}
