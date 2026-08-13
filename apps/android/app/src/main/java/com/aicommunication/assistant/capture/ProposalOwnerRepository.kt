package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi
import com.aicommunication.assistant.tasks.toOwnerTask

/**
 * Owner proposal lifecycle APIs via the shared A9.1 networking stack (S5.1, D176).
 *
 * Canonical suggestion re-read plus approve / edit / dismiss. No UI, recovery orchestration,
 * or persistence lives here.
 */
class ProposalOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val approveRequestAdapter =
        ownerApiMoshi().adapter(ApproveProposalRequestWire::class.java)
    private val editRequestAdapter = ownerApiMoshi().adapter(EditProposalRequestWire::class.java)

    suspend fun getSuggestion(suggestionId: String): OwnerApiResult<TaskSuggestionWire> = get(
        path = "/api/v1/task-suggestions/${enc(suggestionId)}",
        clazz = TaskSuggestionWire::class.java
    )

    suspend fun approve(
        suggestionId: String,
        etag: String,
        responsibility: ProposalResponsibility
    ): OwnerApiResult<ApproveProposalResult> {
        val json =
            approveRequestAdapter.toJson(
                ApproveProposalRequestWire(
                    acknowledgement = ACKNOWLEDGEMENT,
                    responsibility = responsibility.toWire()
                )
            )
        return when (
            val result =
                send(
                    method = OwnerApiRequest.Method.POST,
                    path = "/api/v1/task-suggestions/${enc(suggestionId)}/approve",
                    clazz = ApproveProposalResponseWire::class.java,
                    jsonBody = json,
                    headers = mutationHeaders(etag)
                )
        ) {
            is OwnerApiResult.Success ->
                OwnerApiResult.Success(
                    ApproveProposalResult(
                        suggestion = result.value.suggestion,
                        task = result.value.task.toOwnerTask()
                    )
                )
            OwnerApiResult.Unauthorized -> OwnerApiResult.Unauthorized
            OwnerApiResult.Connectivity -> OwnerApiResult.Connectivity
            OwnerApiResult.NotConfigured -> OwnerApiResult.NotConfigured
            is OwnerApiResult.HttpError -> result
            is OwnerApiResult.Unexpected -> result
        }
    }

    suspend fun edit(
        suggestionId: String,
        etag: String,
        summaryPoints: List<CaptureSummaryPointWire>
    ): OwnerApiResult<TaskSuggestionWire> {
        val json = editRequestAdapter.toJson(EditProposalRequestWire(summaryPoints))
        return send(
            method = OwnerApiRequest.Method.POST,
            path = "/api/v1/task-suggestions/${enc(suggestionId)}/edit",
            clazz = TaskSuggestionWire::class.java,
            jsonBody = json,
            headers = mutationHeaders(etag)
        )
    }

    /**
     * Bodyless dismiss is accepted by the server when Content-Type is not JSON. The shared
     * executor always POSTs `application/json`, so the minimal compatible body is `{}` — the
     * same pattern as Task dismiss — rather than an empty string (invalid JSON → 400) or a
     * reason payload.
     */
    suspend fun dismiss(suggestionId: String, etag: String): OwnerApiResult<TaskSuggestionWire> =
        send(
            method = OwnerApiRequest.Method.POST,
            path = "/api/v1/task-suggestions/${enc(suggestionId)}/dismiss",
            clazz = TaskSuggestionWire::class.java,
            jsonBody = "{}",
            headers = mutationHeaders(etag)
        )

    private fun mutationHeaders(etag: String): Map<String, String> = mapOf(
        "If-Match" to etag,
        "Content-Type" to "application/json"
    )

    private fun enc(value: String): String = java.net.URLEncoder.encode(
        value,
        Charsets.UTF_8.name()
    )

    companion object {
        const val ACKNOWLEDGEMENT = "suggestion_approved"
    }
}
