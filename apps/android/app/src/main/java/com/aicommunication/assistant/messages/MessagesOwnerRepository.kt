package com.aicommunication.assistant.messages

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi
import java.util.UUID

/**
 * Owner Google Messages Review with Rocket via the shared A9.1 networking stack (D181).
 *
 * Review POSTs one explicitly selected eligible occurrence. It creates no Task, assignment,
 * capability, or SMS side effect. Notification arrival never calls this repository.
 */
class MessagesOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val reviewRequestAdapter =
        ownerApiMoshi().adapter(MessagesReviewRequestWire::class.java)

    suspend fun createReview(
        idempotencyKey: String,
        sourceOccurrenceId: String,
        selectedText: String,
        observedAt: String
    ): OwnerApiResult<MessagesReviewResponseWire> = send(
        method = OwnerApiRequest.Method.POST,
        path = "/api/v1/messages/reviews",
        clazz = MessagesReviewResponseWire::class.java,
        jsonBody =
        reviewRequestAdapter.toJson(
            MessagesReviewRequestWire(
                sourceOccurrenceId = sourceOccurrenceId,
                selectedText = selectedText,
                observedAt = observedAt
            )
        ),
        headers =
        mapOf(
            "Content-Type" to "application/json",
            "Idempotency-Key" to idempotencyKey
        )
    )

    companion object {
        /** Messages-review-specific namespace; satisfies the contracted Idempotency-Key format. */
        fun newIdempotencyKey(): String = "messages-review-${UUID.randomUUID()}"
    }
}
