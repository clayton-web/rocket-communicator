package com.aicommunication.assistant.network

import com.aicommunication.assistant.contracts.models.AuthenticatedRole
import com.aicommunication.assistant.contracts.models.ErrorCode
import com.squareup.moshi.FromJson
import com.squareup.moshi.Json
import com.squareup.moshi.Moshi
import com.squareup.moshi.ToJson
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory

object AuthenticatedRoleJsonAdapter {
    @FromJson
    fun fromJson(value: String): AuthenticatedRole = AuthenticatedRole.decode(value)
        ?: throw IllegalArgumentException("Unknown AuthenticatedRole: $value")

    @ToJson
    fun toJson(value: AuthenticatedRole): String = value.value
}

object ErrorCodeJsonAdapter {
    @FromJson
    fun fromJson(value: String): ErrorCode =
        ErrorCode.entries.firstOrNull { it.value.equals(value, ignoreCase = true) }
            ?: throw IllegalArgumentException("Unknown ErrorCode: $value")

    @ToJson
    fun toJson(value: ErrorCode): String = value.value
}

fun ownerApiMoshi(): Moshi = Moshi.Builder()
    .add(AuthenticatedRoleJsonAdapter)
    .add(ErrorCodeJsonAdapter)
    .add(KotlinJsonAdapterFactory())
    .build()

/**
 * Best-effort public error envelope parse — string code/message/requestId only so unit
 * tests do not depend on Android `org.json` stubs or UUID adapters.
 */
data class ParsedApiError(
    val code: ErrorCode?,
    val message: String,
    val requestId: String?
)

private data class ErrorEnvelopeDto(
    @Json(name = "error") val error: ErrorBodyDto?
)

private data class ErrorBodyDto(
    @Json(name = "code") val code: String?,
    @Json(name = "message") val message: String?,
    @Json(name = "requestId") val requestId: String?
)

private val errorEnvelopeAdapter =
    ownerApiMoshi().adapter(ErrorEnvelopeDto::class.java)

fun parseApiErrorBody(body: String?, httpStatus: Int): ParsedApiError {
    if (body.isNullOrBlank()) {
        return ParsedApiError(
            code = null,
            message = "Request failed with HTTP $httpStatus.",
            requestId = null
        )
    }
    return try {
        val envelope = errorEnvelopeAdapter.fromJson(body)
        val error = envelope?.error
        if (error == null) {
            ParsedApiError(null, "Request failed with HTTP $httpStatus.", null)
        } else {
            val code =
                error.code?.let { raw ->
                    ErrorCode.entries.firstOrNull { entry ->
                        entry.value.equals(raw, ignoreCase = true)
                    }
                }
            val message =
                error.message?.takeIf { it.isNotBlank() }
                    ?: "Request failed with HTTP $httpStatus."
            ParsedApiError(code, message, error.requestId?.takeIf { it.isNotBlank() })
        }
    } catch (_: Exception) {
        ParsedApiError(null, "Request failed with HTTP $httpStatus.", null)
    }
}
