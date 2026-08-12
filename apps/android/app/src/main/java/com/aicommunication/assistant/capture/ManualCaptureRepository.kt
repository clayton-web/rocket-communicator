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

    suspend fun createManualCapture(
        idempotencyKey: String,
        request: ManualCaptureRequestWire
    ): OwnerApiResult<ManualCaptureResponseWire> = send(
        method = OwnerApiRequest.Method.POST,
        path = "/api/v1/manual-captures",
        clazz = ManualCaptureResponseWire::class.java,
        jsonBody = requestAdapter.toJson(request),
        headers =
        mapOf(
            "Content-Type" to "application/json",
            "Idempotency-Key" to idempotencyKey
        )
    )

    companion object {
        /** Capture-specific namespace; satisfies the contracted Idempotency-Key format. */
        fun newIdempotencyKey(): String = "capture-${UUID.randomUUID()}"
    }
}
