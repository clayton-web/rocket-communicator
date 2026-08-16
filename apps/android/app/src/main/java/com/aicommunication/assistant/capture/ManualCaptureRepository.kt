package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi
import java.util.UUID

/**
 * Owner manual capture via the existing A9.1 networking stack (S3.3, D171).
 *
 * The request carries no organization and no source kind: provenance is fixed server-side and the
 * organization comes only from the authenticated Owner session.
 */
class ManualCaptureRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val requestAdapter = ownerApiMoshi().adapter(ManualCaptureRequestWire::class.java)

    /** Which deployment capture is submitted to; host only, for privacy-safe diagnostics. */
    val apiHostLabel: String
        get() = executor.apiHostLabel

    suspend fun createManualCapture(
        idempotencyKey: String,
        request: ManualCaptureRequestWire
    ): OwnerApiResult<ManualCaptureResponseWire> = send(
        method = METHOD,
        path = PATH,
        clazz = ManualCaptureResponseWire::class.java,
        jsonBody = requestAdapter.toJson(request),
        headers =
        mapOf(
            "Content-Type" to "application/json",
            "Idempotency-Key" to idempotencyKey
        )
    )

    companion object {
        /**
         * The canonical Owner manual-capture contract (D170, D171). Named constants so the
         * classification and diagnostics below describe the request that was actually sent
         * instead of restating the contract from memory.
         */
        val METHOD = OwnerApiRequest.Method.POST

        const val PATH = "/api/v1/manual-captures"

        /** Capture-specific namespace; satisfies the contracted Idempotency-Key format. */
        fun newIdempotencyKey(): String = "capture-${UUID.randomUUID()}"
    }
}
