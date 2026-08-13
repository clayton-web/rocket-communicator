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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Proposal lifecycle Owner APIs through the shared A9.1 networking stack (S5.1, D176).
 */
class ProposalOwnerRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: ProposalOwnerRepository

    private val approveRequestAdapter =
        ownerApiMoshi().adapter(ApproveProposalRequestWire::class.java)
    private val editRequestAdapter = ownerApiMoshi().adapter(EditProposalRequestWire::class.java)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository = ProposalOwnerRepository(executor(token = "access-token"))
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

    private val suggestionJson =
        """
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
          "updatedAt": "2026-08-12T15:04:05.123Z",
          "approvedTaskId": null
        }
        """.trimIndent()

    private val approvedSuggestionJson =
        """
        {
          "id": "sug-1",
          "organizationId": "org-1",
          "status": "approved",
          "summaryPoints": [
            {"id":"p1","kind":"next_action","label":"Next","order":0,
             "value":"Call the roofer"}
          ],
          "version": 2,
          "etag": "\"task-suggestion-sug-1-v2\"",
          "createdAt": "2026-08-12T15:04:05.123Z",
          "updatedAt": "2026-08-12T15:04:06.000Z",
          "approvedTaskId": "task-1"
        }
        """.trimIndent()

    private val taskJson =
        """
        {
          "id": "task-1",
          "etag": "\"task-task-1-v1\"",
          "status": "open",
          "version": 1,
          "summaryPoints": [
            {"id":"p1","kind":"next_action","label":"Next","order":0,
             "value":"Call the roofer"}
          ]
        }
        """.trimIndent()

    private val approveSuccessBody =
        """{"suggestion":$approvedSuggestionJson,"task":$taskJson}"""

    private val editedPoints =
        listOf(
            CaptureSummaryPointWire(
                id = "p1",
                kind = "next_action",
                label = "Next",
                order = 0,
                value = "Call the roofer this afternoon"
            )
        )

    @Test
    fun getSuggestion_usesAuthenticatedOwnerRouteAndDecodesCanonicalFields() = runTest {
        enqueueSuccess(suggestionJson)

        val result = repository.getSuggestion("sug-1") as OwnerApiResult.Success
        val suggestion = result.value

        val sent = server.takeRequest()
        assertEquals("GET", sent.method)
        assertEquals("/api/v1/task-suggestions/sug-1", sent.path)
        assertEquals("Bearer access-token", sent.getHeader("Authorization"))

        assertEquals("sug-1", suggestion.id)
        assertEquals("pending", suggestion.status)
        assertEquals(1, suggestion.version)
        assertEquals("\"task-suggestion-sug-1-v1\"", suggestion.etag)
        assertEquals("Call the roofer", suggestion.summaryPoints.single().value)
        assertNull(suggestion.approvedTaskId)
    }

    @Test
    fun getSuggestion_decodesApprovedTaskIdWhenPresent() = runTest {
        enqueueSuccess(approvedSuggestionJson)

        val result = repository.getSuggestion("sug-1") as OwnerApiResult.Success

        assertEquals("approved", result.value.status)
        assertEquals("task-1", result.value.approvedTaskId)
        assertEquals(2, result.value.version)
        assertEquals("\"task-suggestion-sug-1-v2\"", result.value.etag)
    }

    @Test
    fun approveOwner_sendsRouteIfMatchAcknowledgementAndOmitsRecipientId() = runTest {
        enqueueSuccess(approveSuccessBody)

        repository.approve(
            suggestionId = "sug-1",
            etag = "\"task-suggestion-sug-1-v1\"",
            responsibility = ProposalResponsibility.Owner
        )

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/task-suggestions/sug-1/approve", sent.path)
        assertEquals("\"task-suggestion-sug-1-v1\"", sent.getHeader("If-Match"))
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))

        val raw = sent.body.readUtf8()
        val body = requireNotNull(approveRequestAdapter.fromJson(raw))
        assertEquals("suggestion_approved", body.acknowledgement)
        assertEquals("owner", body.responsibility.responsibleParty)
        assertNull(body.responsibility.recipientId)
        assertFalse(raw.contains("\"recipientId\""))
        assertFalse(raw.contains("dueAt"))
        assertFalse(raw.contains("priority"))
        assertFalse(raw.contains("summaryPoints"))
    }

    @Test
    fun approveRecipient_serializesResponsibilityWithoutLegacyTopLevelRecipientId() = runTest {
        enqueueSuccess(approveSuccessBody)

        repository.approve(
            suggestionId = "sug-1",
            etag = "\"task-suggestion-sug-1-v1\"",
            responsibility = ProposalResponsibility.Recipient("rcp-1")
        )

        val sent = server.takeRequest()
        assertEquals("\"task-suggestion-sug-1-v1\"", sent.getHeader("If-Match"))

        val raw = sent.body.readUtf8()
        val body = requireNotNull(approveRequestAdapter.fromJson(raw))
        assertEquals("suggestion_approved", body.acknowledgement)
        assertEquals("recipient", body.responsibility.responsibleParty)
        assertEquals("rcp-1", body.responsibility.recipientId)

        val recipientIdIndex = raw.indexOf("\"recipientId\"")
        assertTrue(recipientIdIndex >= 0)
        assertEquals(recipientIdIndex, raw.lastIndexOf("\"recipientId\""))
        val responsibilityIndex = raw.indexOf("\"responsibility\"")
        assertTrue(recipientIdIndex > responsibilityIndex)
    }

    @Test
    fun approve_decodesUpdatedSuggestionAndCanonicalTask() = runTest {
        enqueueSuccess(approveSuccessBody)

        val result =
            repository.approve(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\"",
                responsibility = ProposalResponsibility.Owner
            ) as OwnerApiResult.Success

        assertEquals("approved", result.value.suggestion.status)
        assertEquals("task-1", result.value.suggestion.approvedTaskId)
        assertEquals(2, result.value.suggestion.version)
        assertEquals("\"task-suggestion-sug-1-v2\"", result.value.suggestion.etag)
        assertEquals("task-1", result.value.task.id)
        assertEquals("open", result.value.task.status)
        assertEquals("Call the roofer", result.value.task.displayTitle)
        assertEquals("\"task-task-1-v1\"", result.value.task.etag)
    }

    @Test
    fun edit_sendsAuthorizedSummaryPointsAndDecodesNewVersion() = runTest {
        enqueueSuccess(
            """
            {
              "id": "sug-1",
              "organizationId": "org-1",
              "status": "pending",
              "summaryPoints": [
                {"id":"p1","kind":"next_action","label":"Next","order":0,
                 "value":"Call the roofer this afternoon"}
              ],
              "version": 2,
              "etag": "\"task-suggestion-sug-1-v2\"",
              "createdAt": "2026-08-12T15:04:05.123Z",
              "updatedAt": "2026-08-12T15:04:06.000Z"
            }
            """.trimIndent()
        )

        val result =
            repository.edit(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\"",
                summaryPoints = editedPoints
            ) as OwnerApiResult.Success

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/task-suggestions/sug-1/edit", sent.path)
        assertEquals("\"task-suggestion-sug-1-v1\"", sent.getHeader("If-Match"))

        val raw = sent.body.readUtf8()
        val body = requireNotNull(editRequestAdapter.fromJson(raw))
        val point = body.summaryPoints.single()
        assertEquals("p1", point.id)
        assertEquals("next_action", point.kind)
        assertEquals(0, point.order)
        assertEquals("Call the roofer this afternoon", point.value)
        assertFalse(raw.contains("proposedRecipientId"))
        assertFalse(raw.contains("proposedDueAt"))
        assertFalse(raw.contains("proposedPriority"))

        assertEquals(2, result.value.version)
        assertEquals("\"task-suggestion-sug-1-v2\"", result.value.etag)
        assertEquals("Call the roofer this afternoon", result.value.summaryPoints.single().value)
    }

    @Test
    fun edit_mixedKindPoints_serializeLosslessKindSpecificFields() = runTest {
        enqueueSuccess(suggestionJson)

        val mixedPoints =
            listOf(
                CaptureSummaryPointWire(
                    id = "p-request",
                    kind = "request",
                    label = "Request",
                    order = 0,
                    value = "Call the roofer this afternoon"
                ),
                CaptureSummaryPointWire(
                    id = "p-amount",
                    kind = "amount",
                    label = "Deposit",
                    order = 1,
                    amount = 500.0,
                    currency = "USD"
                ),
                CaptureSummaryPointWire(
                    id = "p-deadline",
                    kind = "deadline",
                    label = "Due",
                    order = 2,
                    localDate = "2026-08-20",
                    timezone = "America/Los_Angeles"
                ),
                CaptureSummaryPointWire(
                    id = "p-missing",
                    kind = "missing_information",
                    label = "Missing",
                    order = 3,
                    missingItem = "Property street address"
                ),
                CaptureSummaryPointWire(
                    id = "p-inference",
                    kind = "inference",
                    label = "Likely",
                    order = 4,
                    value = "Owner sounded urgent",
                    confidence = 0.7
                )
            )

        repository.edit(
            suggestionId = "sug-1",
            etag = "\"task-suggestion-sug-1-v1\"",
            summaryPoints = mixedPoints
        )

        val raw = server.takeRequest().body.readUtf8()
        val body = requireNotNull(editRequestAdapter.fromJson(raw))
        assertEquals(5, body.summaryPoints.size)
        assertEquals("Call the roofer this afternoon", body.summaryPoints[0].value)
        assertEquals(500.0, body.summaryPoints[1].amount)
        assertEquals("USD", body.summaryPoints[1].currency)
        assertEquals("2026-08-20", body.summaryPoints[2].localDate)
        assertEquals("America/Los_Angeles", body.summaryPoints[2].timezone)
        assertEquals("Property street address", body.summaryPoints[3].missingItem)
        assertEquals(0.7, body.summaryPoints[4].confidence)
        assertFalse(raw.contains("proposedRecipientId"))
        assertFalse(raw.contains("proposedDueAt"))
        assertFalse(raw.contains("proposedPriority"))
    }

    @Test
    fun dismiss_sendsMinimalJsonObjectWithoutReason() = runTest {
        enqueueSuccess(
            """
            {
              "id": "sug-1",
              "organizationId": "org-1",
              "status": "dismissed",
              "summaryPoints": [
                {"id":"p1","kind":"next_action","label":"Next","order":0,
                 "value":"Call the roofer"}
              ],
              "version": 2,
              "etag": "\"task-suggestion-sug-1-v2\"",
              "createdAt": "2026-08-12T15:04:05.123Z",
              "updatedAt": "2026-08-12T15:04:06.000Z"
            }
            """.trimIndent()
        )

        val result =
            repository.dismiss(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\""
            ) as OwnerApiResult.Success

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/task-suggestions/sug-1/dismiss", sent.path)
        assertEquals("\"task-suggestion-sug-1-v1\"", sent.getHeader("If-Match"))
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("{}", sent.body.readUtf8())
        assertEquals("dismissed", result.value.status)
        assertEquals(2, result.value.version)
    }

    @Test
    fun withoutASessionTheRequestIsNeverSent() = runTest {
        val unauthenticated = ProposalOwnerRepository(executor(token = null))

        val result = unauthenticated.getSuggestion("sug-1")

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun preconditionFailedSurfacesAsClassifiableHttpError() = runTest {
        enqueueError(412, "PRECONDITION_FAILED")

        val result =
            repository.approve(
                suggestionId = "sug-1",
                etag = "\"stale\"",
                responsibility = ProposalResponsibility.Owner
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(412, error.httpStatus)
        assertEquals(ErrorCode.PRECONDITION_FAILED, error.code)
    }

    @Test
    fun invalidStateTransitionSurfacesAsClassifiableHttpError() = runTest {
        enqueueError(409, "INVALID_STATE_TRANSITION")

        val result =
            repository.approve(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\"",
                responsibility = ProposalResponsibility.Owner
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(409, error.httpStatus)
        assertEquals(ErrorCode.INVALID_STATE_TRANSITION, error.code)
    }

    @Test
    fun validationErrorSurfacesAsClassifiableHttpError() = runTest {
        enqueueError(400, "VALIDATION_ERROR")

        val result =
            repository.approve(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\"",
                responsibility = ProposalResponsibility.Owner
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(400, error.httpStatus)
        assertEquals(ErrorCode.VALIDATION_ERROR, error.code)
    }

    @Test
    fun preconditionRequiredSurfacesAsClassifiableHttpError() = runTest {
        enqueueError(428, "PRECONDITION_REQUIRED")

        val result =
            repository.edit(
                suggestionId = "sug-1",
                etag = "\"task-suggestion-sug-1-v1\"",
                summaryPoints = editedPoints
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(428, error.httpStatus)
        assertEquals(ErrorCode.PRECONDITION_REQUIRED, error.code)
    }

    @Test
    fun notFoundSurfacesAsClassifiableHttpError() = runTest {
        enqueueError(404, "NOT_FOUND")

        val result = repository.getSuggestion("missing")

        val error = result as OwnerApiResult.HttpError
        assertEquals(404, error.httpStatus)
        assertEquals(ErrorCode.NOT_FOUND, error.code)
    }
}
