package com.aicommunication.assistant.messages

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesReviewOutcomeTest {
    @Test
    fun successAndTerminalRejectionsDoNotPreserveTheAttempt() {
        assertFalse(MessagesReviewOutcome.SUCCESS.preservesAttempt)
        assertFalse(MessagesReviewOutcome.VALIDATION_FAILURE.preservesAttempt)
        assertFalse(MessagesReviewOutcome.NOT_FOUND.preservesAttempt)
        assertFalse(MessagesReviewOutcome.INELIGIBLE.preservesAttempt)
        assertFalse(MessagesReviewOutcome.IDEMPOTENCY_CONFLICT.preservesAttempt)
    }

    @Test
    fun ambiguousOutcomesPreserveTheAttempt() {
        assertTrue(MessagesReviewOutcome.DEPENDENCY_UNAVAILABLE.preservesAttempt)
        assertTrue(MessagesReviewOutcome.CONNECTIVITY.preservesAttempt)
        assertTrue(MessagesReviewOutcome.UNAUTHORIZED.preservesAttempt)
        assertTrue(MessagesReviewOutcome.UNEXPECTED.preservesAttempt)
    }

    @Test
    fun classify_mapsDocumentedReviewErrors() {
        assertEqualsOutcome(
            MessagesReviewOutcome.DEPENDENCY_UNAVAILABLE,
            http(503, ErrorCode.DEPENDENCY_UNAVAILABLE)
        )
        assertEqualsOutcome(
            MessagesReviewOutcome.IDEMPOTENCY_CONFLICT,
            http(409, ErrorCode.IDEMPOTENCY_KEY_CONFLICT)
        )
        assertEqualsOutcome(
            MessagesReviewOutcome.VALIDATION_FAILURE,
            http(400, ErrorCode.VALIDATION_ERROR)
        )
        assertEqualsOutcome(MessagesReviewOutcome.UNAUTHORIZED, OwnerApiResult.Unauthorized)
        assertEqualsOutcome(MessagesReviewOutcome.CONNECTIVITY, OwnerApiResult.Connectivity)
        assertEqualsOutcome(
            MessagesReviewOutcome.SUCCESS,
            OwnerApiResult.Success(Unit)
        )
    }

    private fun assertEqualsOutcome(expected: MessagesReviewOutcome, result: OwnerApiResult<*>) {
        org.junit.Assert.assertEquals(expected, MessagesReviewOutcome.classify(result))
    }

    private fun http(status: Int, code: ErrorCode) = OwnerApiResult.HttpError(
        httpStatus = status,
        code = code,
        message = "nope",
        requestId = "req-1"
    )
}
