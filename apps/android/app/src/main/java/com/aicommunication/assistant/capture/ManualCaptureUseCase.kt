package com.aicommunication.assistant.capture

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.OwnerApiResult
import java.time.Instant
import java.time.ZoneId

/**
 * Manual capture submission and durable-retry foundation (S3.3, D171).
 *
 * Not reachable from the Owner UI in this slice: the capture screen still uses the legacy
 * direct-create path. This layer owns the frozen retry identity so a later presentation slice can
 * offer Retry / Discard without reasoning about idempotency itself.
 */
class ManualCaptureUseCase(
    private val repository: ManualCaptureRepository,
    private val pendingStore: PendingCaptureStore
) {
    /** Still-valid pending capture to resume after ambiguous failure or process death. */
    fun pendingCapture(): PendingCaptureOperation? = pendingStore.read()

    /**
     * Freezes a brand-new capture identity and persists it before any network request. Returns
     * null for a blank draft, which is not a capture. A changed draft is a new semantic request:
     * callers discard the old operation rather than mutating its `rawInput`.
     */
    fun beginCapture(rawInput: String): PendingCaptureOperation? {
        val frozen = rawInput.trim()
        if (frozen.isEmpty()) {
            return null
        }
        val now = Instant.now().toString()
        val operation =
            PendingCaptureOperation(
                idempotencyKey = ManualCaptureRepository.newIdempotencyKey(),
                rawInput = frozen,
                capturedAt = now,
                timezone = ZoneId.systemDefault().id,
                createdAt = now
            )
        pendingStore.write(operation)
        return operation
    }

    fun discardPending() {
        pendingStore.clear()
    }

    /**
     * Sends the persisted tuple verbatim — a retry regenerates no field, so the server can replay
     * a committed interpretation instead of interpreting the same capture twice.
     *
     * Pending state survives every outcome where backend success cannot be ruled out, and is
     * cleared on terminal failures. Success deliberately keeps the record until the caller
     * confirms the result reached the Owner via [discardPending] (D171).
     */
    suspend fun submit(
        operation: PendingCaptureOperation
    ): OwnerApiResult<ManualCaptureResponseWire> {
        pendingStore.write(operation)
        val result =
            repository.createManualCapture(
                idempotencyKey = operation.idempotencyKey,
                request =
                ManualCaptureRequestWire(
                    rawInput = operation.rawInput,
                    capturedAt = operation.capturedAt,
                    timezone = operation.timezone
                )
            )
        val outcome = ManualCaptureOutcome.classify(result)
        if (!outcome.preservesPending && outcome != ManualCaptureOutcome.SUCCESS) {
            pendingStore.clear()
        }
        return result
    }
}

/**
 * Classification of an existing [OwnerApiResult] for the later ViewModel — a lens over the shared
 * result type, not a parallel result hierarchy.
 */
enum class ManualCaptureOutcome(val preservesPending: Boolean) {
    SUCCESS(false),
    VALIDATION_FAILURE(false),
    IDEMPOTENCY_CONFLICT(false),
    DEPENDENCY_UNAVAILABLE(true),
    UNAUTHORIZED(true),
    CONNECTIVITY(true),
    UNEXPECTED(true);

    companion object {
        fun classify(result: OwnerApiResult<*>): ManualCaptureOutcome = when (result) {
            is OwnerApiResult.Success -> SUCCESS
            OwnerApiResult.Connectivity -> CONNECTIVITY
            OwnerApiResult.NotConfigured -> UNEXPECTED
            OwnerApiResult.Unauthorized -> UNAUTHORIZED
            is OwnerApiResult.Unexpected -> UNEXPECTED
            is OwnerApiResult.HttpError -> classifyHttp(result)
        }

        /**
         * Only the statuses the route documents as rejecting the request outright are terminal;
         * anything else falls through to [UNEXPECTED] and keeps the tuple, because an unmodelled
         * response cannot rule out a committed interpretation.
         */
        private fun classifyHttp(error: OwnerApiResult.HttpError): ManualCaptureOutcome = when {
            error.code == ErrorCode.DEPENDENCY_UNAVAILABLE -> DEPENDENCY_UNAVAILABLE
            error.httpStatus == 503 -> DEPENDENCY_UNAVAILABLE
            error.httpStatus == 409 -> IDEMPOTENCY_CONFLICT
            error.httpStatus == 400 -> VALIDATION_FAILURE
            error.httpStatus == 415 -> VALIDATION_FAILURE
            error.httpStatus == 428 -> VALIDATION_FAILURE
            else -> UNEXPECTED
        }
    }
}
