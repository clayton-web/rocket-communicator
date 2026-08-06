package com.aicommunication.assistant.network

import com.aicommunication.assistant.contracts.models.ErrorCode

/**
 * Standardized Owner API outcome (A9.1). Presentation maps these; it does not invent auth.
 */
sealed class OwnerApiResult<out T> {
    data class Success<T>(val value: T) : OwnerApiResult<T>()

    data class HttpError(
        val httpStatus: Int,
        val code: ErrorCode?,
        val message: String,
        val requestId: String?
    ) : OwnerApiResult<Nothing>()

    data object Unauthorized : OwnerApiResult<Nothing>()

    data object Connectivity : OwnerApiResult<Nothing>()

    data object NotConfigured : OwnerApiResult<Nothing>()

    data class Unexpected(val message: String) : OwnerApiResult<Nothing>()
}
