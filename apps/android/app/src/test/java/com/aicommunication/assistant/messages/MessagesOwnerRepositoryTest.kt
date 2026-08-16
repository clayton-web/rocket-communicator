package com.aicommunication.assistant.messages

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

class MessagesOwnerRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: MessagesOwnerRepository
    private val requestAdapter = ownerApiMoshi().adapter(MessagesReviewRequestWire::class.java)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository = MessagesOwnerRepository(executor(token = "access-token"))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun createReview_sendsExactContractBodyAndIdempotencyKey() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        repository.createReview(
            idempotencyKey = "messages-review-key-1",
            sourceOccurrenceId = "0|com.google.android.apps.messaging|1|null|0",
            selectedText = "Can you call me tomorrow",
            observedAt = "2023-11-14T22:13:20Z"
        )

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/messages/reviews", sent.path)
        assertEquals("messages-review-key-1", sent.getHeader("Idempotency-Key"))
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("Bearer access-token", sent.getHeader("Authorization"))

        val raw = sent.body.readUtf8()
        val body = requireNotNull(requestAdapter.fromJson(raw))
        assertEquals("0|com.google.android.apps.messaging|1|null|0", body.sourceOccurrenceId)
        assertEquals("Can you call me tomorrow", body.selectedText)
        assertEquals("2023-11-14T22:13:20Z", body.observedAt)
        assertTrue(raw.contains("\"sourceOccurrenceId\""))
        assertTrue(raw.contains("\"selectedText\""))
        assertTrue(raw.contains("\"observedAt\""))
        assertFalse(raw.contains("\"organizationId\""))
        assertFalse(raw.contains("\"sourceKind\""))
        assertFalse(raw.contains("\"accountId\""))
        assertFalse(raw.contains("\"sender\""))
        assertFalse(raw.contains("\"phone\""))
        assertFalse(raw.contains("\"title\""))
        assertFalse(raw.contains("\"conversationTitle\""))
        assertFalse(raw.contains("keySegmentCount"))
        assertFalse(raw.contains("keyTagClass"))
        assertFalse(raw.contains("keyTagPresence"))
        assertFalse(raw.contains("keyPackageSegmentMatchesObservedPackage"))
    }

    @Test
    fun createReview_parsesZeroProposalSuccess() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        val result =
            repository.createReview(
                "messages-review-key-1",
                "occ-1",
                "text",
                "2023-11-14T22:13:20Z"
            ) as OwnerApiResult.Success

        assertTrue(result.value.taskSuggestions.isEmpty())
        assertFalse(result.value.idempotentReplay)
        assertEquals("2026-08-13T18:00:00.000Z", result.value.interpretedAt)
    }

    @Test
    fun createReview_parsesProposalsAndReplayFlag() = runTest {
        enqueueReviewSuccess(proposalReviewBody)

        val result =
            repository.createReview(
                "messages-review-key-1",
                "occ-1",
                "text",
                "2023-11-14T22:13:20Z"
            ) as OwnerApiResult.Success

        assertTrue(result.value.idempotentReplay)
        val proposal = result.value.taskSuggestions.single()
        assertEquals("sug-1", proposal.id)
        assertEquals("pending", proposal.status)
        assertEquals("Call Ada tomorrow", proposal.summaryPoints.single().value)
    }

    @Test
    fun createReview_doesNotPostToTasks() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        repository.createReview("messages-review-key-1", "occ-1", "text", "2023-11-14T22:13:20Z")

        assertEquals("/api/v1/messages/reviews", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun createReview_dependencyUnavailableSurfacesAsHttpError() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")

        val result =
            repository.createReview(
                "messages-review-key-1",
                "occ-1",
                "text",
                "2023-11-14T22:13:20Z"
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(503, error.httpStatus)
        assertEquals(ErrorCode.DEPENDENCY_UNAVAILABLE, error.code)
        assertEquals(
            MessagesReviewOutcome.DEPENDENCY_UNAVAILABLE,
            MessagesReviewOutcome.classify(result)
        )
    }

    @Test
    fun withoutASessionTheReviewIsNeverSent() = runTest {
        val unauthenticated = MessagesOwnerRepository(executor(token = null))

        val result =
            unauthenticated.createReview(
                "messages-review-key-1",
                "occ-1",
                "text",
                "2023-11-14T22:13:20Z"
            )

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun newIdempotencyKeySatisfiesContractedFormat() {
        val key = MessagesOwnerRepository.newIdempotencyKey()
        assertTrue(key.startsWith("messages-review-"))
        assertTrue(key.length in 8..128)
        assertTrue(key.matches(Regex("^[A-Za-z0-9._~-]+$")))
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

    private fun enqueueReviewSuccess(body: String) {
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

    private val proposalReviewBody =
        """
        {
          "idempotentReplay": true,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": [
            {
              "id": "sug-1",
              "organizationId": "org-1",
              "status": "pending",
              "summaryPoints": [
                {"id":"p1","kind":"request","label":"Request","order":0,
                 "value":"Call Ada tomorrow"}
              ],
              "version": 1,
              "etag": "\"task-suggestion-sug-1-v1\"",
              "createdAt": "2026-08-13T18:00:00.000Z",
              "updatedAt": "2026-08-13T18:00:00.000Z"
            }
          ]
        }
        """.trimIndent()
}
