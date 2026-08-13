package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi
import java.util.UUID

/**
 * Gmail Owner APIs via the shared A9.1 networking stack.
 *
 * Connection status remains the A9.3 handoff gate. Intake list and Review with Rocket are S7
 * (D179): they create no Task, assignment, capability, or email side effect.
 */
class GmailOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val reviewRequestAdapter = ownerApiMoshi().adapter(GmailReviewRequestWire::class.java)
    private val exclusionRequestAdapter =
        ownerApiMoshi().adapter(CreateGmailSenderExclusionRequestWire::class.java)

    suspend fun getConnection(): OwnerApiResult<GmailConnectionWire> =
        get("/api/v1/gmail/connection", GmailConnectionWire::class.java)

    suspend fun listIntake(
        cursor: String? = null,
        limit: Int = DEFAULT_INTAKE_LIMIT
    ): OwnerApiResult<GmailIntakePageWire> {
        val path =
            buildString {
                append("/api/v1/gmail/intake?limit=")
                append(limit)
                if (!cursor.isNullOrBlank()) {
                    append("&cursor=")
                    append(cursor)
                }
            }
        return get(path, GmailIntakePageWire::class.java)
    }

    suspend fun createReview(
        idempotencyKey: String,
        communicationEventId: String
    ): OwnerApiResult<GmailReviewResponseWire> = send(
        method = OwnerApiRequest.Method.POST,
        path = "/api/v1/gmail/reviews",
        clazz = GmailReviewResponseWire::class.java,
        jsonBody =
        reviewRequestAdapter.toJson(GmailReviewRequestWire(communicationEventId)),
        headers =
        mapOf(
            "Content-Type" to "application/json",
            "Idempotency-Key" to idempotencyKey
        )
    )

    suspend fun excludeSender(
        communicationEventId: String
    ): OwnerApiResult<GmailSenderExclusionWire> = send(
        method = OwnerApiRequest.Method.POST,
        path = "/api/v1/gmail/sender-exclusions",
        clazz = GmailSenderExclusionWire::class.java,
        jsonBody =
        exclusionRequestAdapter.toJson(
            CreateGmailSenderExclusionRequestWire(communicationEventId)
        ),
        headers = mapOf("Content-Type" to "application/json")
    )

    suspend fun removeSenderExclusion(
        exclusionId: String
    ): OwnerApiResult<GmailSenderExclusionWire> = send(
        method = OwnerApiRequest.Method.DELETE,
        path = "/api/v1/gmail/sender-exclusions/$exclusionId",
        clazz = GmailSenderExclusionWire::class.java
    )

    companion object {
        const val DEFAULT_INTAKE_LIMIT = 25

        /** Gmail-review-specific namespace; satisfies the contracted Idempotency-Key format. */
        fun newIdempotencyKey(): String = "gmail-review-${UUID.randomUUID()}"
    }
}

fun GmailConnectionWire.isConnected(): Boolean = status.equals("connected", ignoreCase = true)

fun GmailConnectionWire.needsSendReconsent(): Boolean {
    if (!isConnected()) return false
    if (requiresSendReconsent == true) return true
    if (canSend == false) return true
    return false
}

fun GmailConnectionWire.canHandoffSend(): Boolean = isConnected() && !needsSendReconsent()
