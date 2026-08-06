package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi

/** Active Recipient list + thin create for ordinary-day handoff (A9.3 / D087). */
class RecipientOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val createAdapter = ownerApiMoshi().adapter(CreateRecipientRequestWire::class.java)

    suspend fun listActiveRecipients(cursor: String? = null): OwnerApiResult<RecipientPageWire> {
        val path =
            buildString {
                append("/api/v1/recipients?limit=50")
                if (!cursor.isNullOrBlank()) {
                    append("&cursor=")
                    append(cursor)
                }
            }
        return get(path, RecipientPageWire::class.java)
    }

    suspend fun createRecipient(displayName: String, email: String): OwnerApiResult<RecipientWire> {
        val json =
            createAdapter.toJson(
                CreateRecipientRequestWire(
                    displayName = displayName.trim(),
                    email = email.trim()
                )
            )
        return send(
            method = OwnerApiRequest.Method.POST,
            path = "/api/v1/recipients",
            clazz = RecipientWire::class.java,
            jsonBody = json,
            headers = mapOf("Content-Type" to "application/json")
        )
    }
}
