package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.OwnerApiResult

/**
 * Privacy-safe record of one capture submission attempt at the network boundary (S3.3 / D171).
 *
 * Exists because "Request failed with HTTP 404." cannot tell an Owner or an operator whether the
 * deployment is missing the capture route, whether hosting rewrote the path, or whether a Rocket
 * handler rejected the request. The documented `POST /api/v1/manual-captures` error contract has
 * no 404 at all, so a 404 that carries no recognized Rocket error code is evidence about the
 * deployment rather than about the capture.
 *
 * This is a **field allowlist**, matching the D114 server-side diagnostics rule and the existing
 * device-side probe idiom. It carries the request shape and the response classification only.
 * It never carries `rawInput`, capture text, names, phone numbers, recipient data, email or SMS
 * contents, the Authorization header, a bearer or refresh token, the Idempotency-Key value, or any
 * response body. It is not uploaded and is not an analytics event.
 */
data class CaptureSubmissionDiagnostic(
    val method: String,
    val path: String,
    val apiHost: String,
    val httpStatus: Int?,
    val serverErrorCode: String?,
    val rocketErrorEnvelope: Boolean,
    val requestId: String?,
    val outcome: ManualCaptureOutcome
) {
    /** True when the capture stays replayable under its original identity after this attempt. */
    val preservesPending: Boolean
        get() = outcome.preservesPending || outcome == ManualCaptureOutcome.SUCCESS

    fun debugLine(): String = "$method $path host=$apiHost " +
        "status=${httpStatus ?: "none"} " +
        "rocketError=$rocketErrorEnvelope " +
        "code=${serverErrorCode ?: "absent"} " +
        "requestId=${requestId ?: "absent"} " +
        "outcome=$outcome retryable=$preservesPending"

    companion object {
        /**
         * Builds the record from the shared [OwnerApiResult] the capture request already returned.
         *
         * [rocketErrorEnvelope] reports whether a non-2xx response carried a **recognized** Rocket
         * `ErrorCode`. That is the discriminator this investigation needed: a Rocket handler always
         * answers a rejected capture with the `ErrorResponse` envelope, so a status with no
         * recognized code did not come from the capture handler.
         */
        fun from(
            result: OwnerApiResult<*>,
            apiHost: String,
            outcome: ManualCaptureOutcome = ManualCaptureOutcome.classify(result)
        ): CaptureSubmissionDiagnostic {
            val error = result as? OwnerApiResult.HttpError
            return CaptureSubmissionDiagnostic(
                method = ManualCaptureRepository.METHOD.name,
                path = ManualCaptureRepository.PATH,
                apiHost = apiHost,
                httpStatus = error?.httpStatus ?: successStatus(result),
                serverErrorCode = error?.code?.value,
                rocketErrorEnvelope = error?.code != null,
                requestId = error?.requestId,
                outcome = outcome
            )
        }

        /**
         * 200 is the route's only success status (D170). Every non-HTTP result — no configuration,
         * no validated network, a refused session, a transport failure — reached no status at all,
         * and reporting one would invent evidence.
         */
        private fun successStatus(result: OwnerApiResult<*>): Int? =
            if (result is OwnerApiResult.Success) 200 else null
    }
}

/** Where a [CaptureSubmissionDiagnostic] goes. Default is nowhere. */
fun interface CaptureSubmissionDiagnosticSink {
    fun record(diagnostic: CaptureSubmissionDiagnostic)

    companion object {
        val Disabled = CaptureSubmissionDiagnosticSink { }
    }
}
