package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GmailReviewOutcomeTest {
    @Test
    fun successAndTerminalRejectionsDoNotPreserveTheAttempt() {
        assertFalse(GmailReviewOutcome.SUCCESS.preservesAttempt)
        assertFalse(GmailReviewOutcome.VALIDATION_FAILURE.preservesAttempt)
        assertFalse(GmailReviewOutcome.NOT_FOUND.preservesAttempt)
        assertFalse(GmailReviewOutcome.INELIGIBLE.preservesAttempt)
        assertFalse(GmailReviewOutcome.IDEMPOTENCY_CONFLICT.preservesAttempt)
    }

    @Test
    fun ambiguousOutcomesPreserveTheAttempt() {
        assertTrue(GmailReviewOutcome.DEPENDENCY_UNAVAILABLE.preservesAttempt)
        assertTrue(GmailReviewOutcome.CONNECTIVITY.preservesAttempt)
        assertTrue(GmailReviewOutcome.UNAUTHORIZED.preservesAttempt)
        assertTrue(GmailReviewOutcome.UNEXPECTED.preservesAttempt)
    }

    @Test
    fun classify_mapsDocumentedReviewErrors() {
        assertEqualsOutcome(
            GmailReviewOutcome.DEPENDENCY_UNAVAILABLE,
            http(503, ErrorCode.DEPENDENCY_UNAVAILABLE)
        )
        assertEqualsOutcome(
            GmailReviewOutcome.NOT_FOUND,
            http(404, ErrorCode.NOT_FOUND)
        )
        assertEqualsOutcome(
            GmailReviewOutcome.INELIGIBLE,
            http(409, ErrorCode.DOMAIN_CONFLICT)
        )
        assertEqualsOutcome(
            GmailReviewOutcome.IDEMPOTENCY_CONFLICT,
            http(409, ErrorCode.IDEMPOTENCY_KEY_CONFLICT)
        )
        assertEqualsOutcome(
            GmailReviewOutcome.VALIDATION_FAILURE,
            http(400, ErrorCode.VALIDATION_ERROR)
        )
        assertEqualsOutcome(
            GmailReviewOutcome.UNEXPECTED,
            http(500, ErrorCode.INTERNAL_ERROR)
        )
        assertEqualsOutcome(GmailReviewOutcome.CONNECTIVITY, OwnerApiResult.Connectivity)
        assertEqualsOutcome(GmailReviewOutcome.UNAUTHORIZED, OwnerApiResult.Unauthorized)
        assertEqualsOutcome(
            GmailReviewOutcome.SUCCESS,
            OwnerApiResult.Success(Unit)
        )
    }

    private fun assertEqualsOutcome(expected: GmailReviewOutcome, result: OwnerApiResult<*>) {
        org.junit.Assert.assertEquals(expected, GmailReviewOutcome.classify(result))
    }

    private fun http(status: Int, code: ErrorCode) = OwnerApiResult.HttpError(
        httpStatus = status,
        code = code,
        message = "nope",
        requestId = "req-1"
    )
}
