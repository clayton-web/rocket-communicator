package com.aicommunication.assistant.messages

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult

/**
 * Classification of a Messages Review `OwnerApiResult` (D181 / D161).
 *
 * Ambiguous outcomes keep the in-memory attempt so Retry reuses the same Idempotency-Key,
 * `sourceOccurrenceId`, `selectedText`, and `observedAt`. Terminal rejections clear it so a
 * later explicit Review with Rocket is a new attempt. A 409 conflict does not mint a replacement
 * key automatically.
 */
enum class MessagesReviewOutcome(val preservesAttempt: Boolean) {
    SUCCESS(false),
    VALIDATION_FAILURE(false),
    NOT_FOUND(false),
    INELIGIBLE(false),
    IDEMPOTENCY_CONFLICT(false),
    DEPENDENCY_UNAVAILABLE(true),
    UNAUTHORIZED(true),
    CONNECTIVITY(true),
    UNEXPECTED(true);

    companion object {
        fun classify(result: OwnerApiResult<*>): MessagesReviewOutcome = when (result) {
            is OwnerApiResult.Success -> SUCCESS
            OwnerApiResult.Connectivity -> CONNECTIVITY
            OwnerApiResult.NotConfigured -> UNEXPECTED
            OwnerApiResult.Unauthorized -> UNAUTHORIZED
            is OwnerApiResult.Unexpected -> UNEXPECTED
            is OwnerApiResult.HttpError -> classifyHttp(result)
        }

        /**
         * Only statuses the route documents as rejecting the request outright are terminal.
         * Anything else falls through to [UNEXPECTED] and keeps the attempt, because an
         * unmodelled response cannot rule out a committed interpretation.
         */
        private fun classifyHttp(error: OwnerApiResult.HttpError): MessagesReviewOutcome = when {
            error.code == ErrorCode.DEPENDENCY_UNAVAILABLE -> DEPENDENCY_UNAVAILABLE
            error.httpStatus == 503 -> DEPENDENCY_UNAVAILABLE
            error.code == ErrorCode.IDEMPOTENCY_KEY_CONFLICT -> IDEMPOTENCY_CONFLICT
            error.code == ErrorCode.DOMAIN_CONFLICT -> INELIGIBLE
            error.code == ErrorCode.NOT_FOUND || error.httpStatus == 404 -> NOT_FOUND
            error.code == ErrorCode.VALIDATION_ERROR -> VALIDATION_FAILURE
            error.httpStatus == 400 || error.httpStatus == 415 || error.httpStatus == 428 ->
                VALIDATION_FAILURE
            else -> UNEXPECTED
        }
    }
}
