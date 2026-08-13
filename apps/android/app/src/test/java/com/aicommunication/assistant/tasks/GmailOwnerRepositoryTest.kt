package com.aicommunication.assistant.tasks

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Gmail intake list and Review with Rocket through the shared A9.1 networking stack (S7, D179).
 */
class GmailOwnerRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: GmailOwnerRepository

    private val reviewRequestAdapter = ownerApiMoshi().adapter(GmailReviewRequestWire::class.java)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository = GmailOwnerRepository(executor(token = "access-token"))
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

    @Test
    fun listIntake_usesDefaultLimitAndMapsNarrowDisplayFields() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "items": [
                        {
                          "id": "evt_intake_mine",
                          "fromAddress": "sender@example.com",
                          "subject": "Please review",
                          "snippet": "Can you look at this",
                          "receivedAt": "2026-08-13T18:00:00.000Z",
                          "organizationId": "org-should-be-ignored",
                          "providerMessageId": "msg-should-be-ignored"
                        }
                      ],
                      "nextCursor": "opaque-cursor"
                    }
                    """.trimIndent()
                )
        )

        val result = repository.listIntake() as OwnerApiResult.Success
        val sent = server.takeRequest()

        assertEquals("GET", sent.method)
        assertEquals("/api/v1/gmail/intake?limit=25", sent.path)
        assertEquals("Bearer access-token", sent.getHeader("Authorization"))
        val item = result.value.items.single()
        assertEquals("evt_intake_mine", item.id)
        assertEquals("sender@example.com", item.fromAddress)
        assertEquals("Please review", item.subject)
        assertEquals("Can you look at this", item.snippet)
        assertEquals("2026-08-13T18:00:00.000Z", item.receivedAt)
        assertEquals("opaque-cursor", result.value.nextCursor)
    }

    @Test
    fun listIntake_sendsCursorOnSubsequentPages() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"items":[],"nextCursor":null}""")
        )

        repository.listIntake(cursor = "page-2")

        assertEquals("/api/v1/gmail/intake?limit=25&cursor=page-2", server.takeRequest().path)
    }

    @Test
    fun listIntake_emptyPageIsSuccess() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"items":[],"nextCursor":null}""")
        )

        val result = repository.listIntake() as OwnerApiResult.Success

        assertTrue(result.value.items.isEmpty())
        assertNull(result.value.nextCursor)
    }

    @Test
    fun createReview_sendsCommunicationEventIdAndIdempotencyKey() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        repository.createReview("gmail-review-key-1", "evt_review_ok")

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/gmail/reviews", sent.path)
        assertEquals("gmail-review-key-1", sent.getHeader("Idempotency-Key"))
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("Bearer access-token", sent.getHeader("Authorization"))

        val body = requireNotNull(reviewRequestAdapter.fromJson(sent.body.readUtf8()))
        assertEquals("evt_review_ok", body.communicationEventId)
    }

    @Test
    fun createReview_sendsNoOrganizationSourceKindOrRawInput() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        repository.createReview("gmail-review-key-1", "evt_review_ok")

        val body = server.takeRequest().body.readUtf8()
        assertFalse(body.contains("organizationId"))
        assertFalse(body.contains("sourceKind"))
        assertFalse(body.contains("rawInput"))
        assertFalse(body.contains("capturedAt"))
    }

    @Test
    fun createReview_parsesZeroProposalSuccess() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        val result =
            repository.createReview("gmail-review-key-1", "evt_review_ok")
                as OwnerApiResult.Success

        assertTrue(result.value.taskSuggestions.isEmpty())
        assertFalse(result.value.idempotentReplay)
        assertEquals("2026-08-13T18:00:00.000Z", result.value.interpretedAt)
    }

    @Test
    fun createReview_parsesProposalsAndReplayFlag() = runTest {
        enqueueReviewSuccess(proposalReviewBody)

        val result =
            repository.createReview("gmail-review-key-1", "evt_review_ok")
                as OwnerApiResult.Success

        assertTrue(result.value.idempotentReplay)
        val proposal = result.value.taskSuggestions.single()
        assertEquals("sug-1", proposal.id)
        assertEquals("pending", proposal.status)
        assertEquals("Send the revised quote", proposal.summaryPoints.single().value)
    }

    @Test
    fun createReview_doesNotPostToTasks() = runTest {
        enqueueReviewSuccess(emptyReviewBody)

        repository.createReview("gmail-review-key-1", "evt_review_ok")

        assertEquals("/api/v1/gmail/reviews", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun createReview_dependencyUnavailableSurfacesAsHttpError() = runTest {
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")

        val result = repository.createReview("gmail-review-key-1", "evt_review_ok")

        val error = result as OwnerApiResult.HttpError
        assertEquals(503, error.httpStatus)
        assertEquals(ErrorCode.DEPENDENCY_UNAVAILABLE, error.code)
        assertEquals(
            GmailReviewOutcome.DEPENDENCY_UNAVAILABLE,
            GmailReviewOutcome.classify(result)
        )
    }

    @Test
    fun withoutASessionTheReviewIsNeverSent() = runTest {
        val unauthenticated = GmailOwnerRepository(executor(token = null))

        val result = unauthenticated.createReview("gmail-review-key-1", "evt_review_ok")

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun newIdempotencyKeySatisfiesContractedFormat() {
        val key = GmailOwnerRepository.newIdempotencyKey()
        assertTrue(key.startsWith("gmail-review-"))
        assertTrue(key.length in 8..128)
        assertTrue(key.matches(Regex("^[A-Za-z0-9._~-]+$")))
    }

    @Test
    fun excludeSender_postsCommunicationEventIdAndOmitsTheAddress() = runTest {
        enqueueExclusionSuccess("gsex_1")

        val result = repository.excludeSender("evt_exclude_ok") as OwnerApiResult.Success

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/gmail/sender-exclusions", sent.path)
        assertEquals("Bearer access-token", sent.getHeader("Authorization"))
        val body = sent.body.readUtf8()
        assertTrue(body.contains("\"communicationEventId\":\"evt_exclude_ok\""))
        assertFalse(body.contains("fromAddress"))
        assertFalse(body.contains("senderAddress"))
        assertEquals("gsex_1", result.value.id)
        assertEquals("2026-08-13T21:00:00.000Z", result.value.createdAt)
    }

    @Test
    fun removeSenderExclusion_deletesById() = runTest {
        enqueueExclusionSuccess("gsex_1")

        val result = repository.removeSenderExclusion("gsex_1") as OwnerApiResult.Success

        val sent = server.takeRequest()
        assertEquals("DELETE", sent.method)
        assertEquals("/api/v1/gmail/sender-exclusions/gsex_1", sent.path)
        assertEquals("gsex_1", result.value.id)
    }

    private fun enqueueExclusionSuccess(id: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """{"id":"$id","createdAt":"2026-08-13T21:00:00.000Z"}"""
                )
        )
    }

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
                 "value":"Send the revised quote"}
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
