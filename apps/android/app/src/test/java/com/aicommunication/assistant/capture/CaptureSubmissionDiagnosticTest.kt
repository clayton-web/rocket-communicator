package com.aicommunication.assistant.capture

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.SafeHttpLogger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Privacy-safe capture submission diagnostics (S3.3 / D171, D114 allowlist rule).
 *
 * Every fixture below uses synthetic capture text and a synthetic phone number so a failing
 * assertion can never print real Owner content.
 */
class CaptureSubmissionDiagnosticTest {
    private val syntheticCapture =
        "Send a pest control to 1 Example Street in Testville, tenant contact Sample +1 555-0100"

    private fun diagnostic(result: OwnerApiResult<*>) =
        CaptureSubmissionDiagnostic.from(result = result, apiHost = "app.example.com")

    @Test
    fun aMissingRouteIsRecordedAsAResponseThatCarriedNoRocketError() {
        // A deployment without the capture route answers with the host's own 404 page, so the
        // body has no ErrorResponse envelope and no recognized code reaches the client.
        val record =
            diagnostic(
                OwnerApiResult.HttpError(
                    httpStatus = 404,
                    code = null,
                    message = "Request failed with HTTP 404.",
                    requestId = null
                )
            )

        assertEquals("POST", record.method)
        assertEquals("/api/v1/manual-captures", record.path)
        assertEquals("app.example.com", record.apiHost)
        assertEquals(404, record.httpStatus)
        assertFalse(record.rocketErrorEnvelope)
        assertNull(record.serverErrorCode)
        assertEquals(ManualCaptureOutcome.ROUTE_UNAVAILABLE, record.outcome)
        assertTrue(record.preservesPending)
    }

    @Test
    fun aRocketRejectionIsDistinguishableFromAMissingRoute() {
        val record =
            diagnostic(
                OwnerApiResult.HttpError(
                    httpStatus = 400,
                    code = ErrorCode.VALIDATION_ERROR,
                    message = "Validation failed.",
                    requestId = "req-1"
                )
            )

        assertTrue(record.rocketErrorEnvelope)
        assertEquals(ErrorCode.VALIDATION_ERROR.value, record.serverErrorCode)
        assertEquals("req-1", record.requestId)
        assertEquals(ManualCaptureOutcome.VALIDATION_FAILURE, record.outcome)
        assertFalse(record.preservesPending)
    }

    @Test
    fun anOutcomeThatReachedNoStatusReportsNoStatus() {
        val reachedNoStatus =
            listOf(
                OwnerApiResult.Connectivity,
                OwnerApiResult.Unauthorized,
                OwnerApiResult.NotConfigured,
                OwnerApiResult.Unexpected("boom")
            )

        for (result in reachedNoStatus) {
            val record = diagnostic(result)
            assertNull("$result must not invent an HTTP status", record.httpStatus)
            assertFalse(record.rocketErrorEnvelope)
            assertTrue(record.debugLine().contains("status=none"))
        }
    }

    @Test
    fun successRecordsTheOnlyContractedSuccessStatus() {
        val record =
            diagnostic(
                OwnerApiResult.Success(
                    ManualCaptureResponseWire(
                        idempotentReplay = false,
                        interpretedAt = "2026-08-12T15:04:05.200Z",
                        taskSuggestions = emptyList()
                    )
                )
            )

        assertEquals(200, record.httpStatus)
        assertEquals(ManualCaptureOutcome.SUCCESS, record.outcome)
        assertTrue(record.preservesPending)
    }

    @Test
    fun theDebugLineNamesTheContractWithoutAnyCaptureContent() {
        val line =
            diagnostic(
                OwnerApiResult.HttpError(
                    httpStatus = 404,
                    code = null,
                    message = syntheticCapture,
                    requestId = null
                )
            )
                .debugLine()

        assertTrue(line.startsWith("POST /api/v1/manual-captures host=app.example.com"))
        assertTrue(line.contains("status=404"))
        assertTrue(line.contains("rocketError=false"))
        assertTrue(line.contains("outcome=ROUTE_UNAVAILABLE"))
        assertTrue(line.contains("retryable=true"))
    }

    @Test
    fun theDebugLineCarriesNoCaptureTextNoContactDataAndNoCredential() {
        val line =
            diagnostic(
                OwnerApiResult.HttpError(
                    httpStatus = 500,
                    code = ErrorCode.INTERNAL_ERROR,
                    // A server that echoed capture content must not widen the diagnostic.
                    message = syntheticCapture,
                    requestId = "req-9"
                )
            )
                .debugLine()

        assertFalse(line.contains("pest control"))
        assertFalse(line.contains("Example Street"))
        assertFalse(line.contains("555-0100"))
        assertFalse(line.contains("Sample"))
        assertFalse(SafeHttpLogger.containsCredentialLeak(line))
    }
}
