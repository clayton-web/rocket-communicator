package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi
import com.aicommunication.assistant.tasks.HandoffRequestWire
import com.aicommunication.assistant.tasks.HandoffResponseWire
import com.aicommunication.assistant.tasks.OwnerTask
import com.aicommunication.assistant.tasks.TaskListPageWire
import com.aicommunication.assistant.tasks.TaskWire
import com.aicommunication.assistant.tasks.toOwnerTask
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * Owner Task APIs via the shared A9.1 networking stack (A9.2 create + A9.3 organize/assign).
 */
class TaskOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val createAdapter = ownerApiMoshi().adapter(CaptureCreateRequest::class.java)
    private val handoffRequestAdapter = ownerApiMoshi().adapter(HandoffRequestWire::class.java)

    suspend fun createCapturedTask(request: CaptureCreateRequest): OwnerApiResult<CapturedTask> {
        val json = createAdapter.toJson(request)
        return when (
            val result =
                send(
                    method = OwnerApiRequest.Method.POST,
                    path = "/api/v1/tasks",
                    clazz = CaptureTaskResponse::class.java,
                    jsonBody = json,
                    headers = mapOf("Content-Type" to "application/json")
                )
        ) {
            is OwnerApiResult.Success ->
                OwnerApiResult.Success(
                    CapturedTask(
                        id = result.value.id,
                        etag = result.value.etag,
                        status = result.value.status,
                        displayTitle =
                        deriveCapturedTaskTitle(result.value.id, result.value.summaryPoints)
                    )
                )
            OwnerApiResult.Unauthorized -> OwnerApiResult.Unauthorized
            OwnerApiResult.Connectivity -> OwnerApiResult.Connectivity
            OwnerApiResult.NotConfigured -> OwnerApiResult.NotConfigured
            is OwnerApiResult.HttpError -> result
            is OwnerApiResult.Unexpected -> result
        }
    }

    suspend fun listTasks(cursor: String? = null, limit: Int = 50): OwnerApiResult<TaskListPage> {
        val path =
            buildString {
                append("/api/v1/tasks?limit=")
                append(limit)
                if (!cursor.isNullOrBlank()) {
                    append("&cursor=")
                    append(cursor)
                }
            }
        return when (val result = get(path, TaskListPageWire::class.java)) {
            is OwnerApiResult.Success ->
                OwnerApiResult.Success(
                    TaskListPage(
                        items = result.value.items.map { it.toOwnerTask() },
                        nextCursor = result.value.nextCursor
                    )
                )
            OwnerApiResult.Unauthorized -> OwnerApiResult.Unauthorized
            OwnerApiResult.Connectivity -> OwnerApiResult.Connectivity
            OwnerApiResult.NotConfigured -> OwnerApiResult.NotConfigured
            is OwnerApiResult.HttpError -> result
            is OwnerApiResult.Unexpected -> result
        }
    }

    suspend fun getTask(taskId: String): OwnerApiResult<OwnerTask> =
        mapTask(get("/api/v1/tasks/${enc(taskId)}", TaskWire::class.java))

    suspend fun startTask(taskId: String, etag: String): OwnerApiResult<OwnerTask> =
        mutate(taskId, "start", etag, jsonBody = null)

    suspend fun markWaiting(taskId: String, etag: String): OwnerApiResult<OwnerTask> {
        val waitingUntil = Instant.now().plus(7, ChronoUnit.DAYS).toString()
        val body = """{"waitingUntil":"$waitingUntil"}"""
        return mutate(taskId, "waiting", etag, jsonBody = body)
    }

    suspend fun resumeTask(taskId: String, etag: String): OwnerApiResult<OwnerTask> =
        mutate(taskId, "resume", etag, jsonBody = null)

    suspend fun completeTask(taskId: String, etag: String): OwnerApiResult<OwnerTask> =
        mutate(taskId, "complete", etag, jsonBody = """{"outcomeType":"completed"}""")

    suspend fun dismissTask(taskId: String, etag: String): OwnerApiResult<OwnerTask> =
        mutate(taskId, "dismiss", etag, jsonBody = "{}")

    /**
     * Owner recovery for a current failed assignment. Contract: Task If-Match, no
     * Idempotency-Key, no business payload. The shared executor POSTs JSON, so the
     * transport body is `{}` — the same pattern as Task dismiss. A missing answer
     * must not be repeated here.
     */
    suspend fun returnTaskToOwner(taskId: String, etag: String): OwnerApiResult<OwnerTask> =
        mutate(taskId, "return-to-owner", etag, jsonBody = "{}")

    suspend fun addNote(taskId: String, etag: String, body: String): OwnerApiResult<OwnerTask> {
        val escaped = body.replace("\\", "\\\\").replace("\"", "\\\"")
        return mutate(taskId, "notes", etag, jsonBody = """{"body":"$escaped"}""")
    }

    suspend fun handoffTask(
        taskId: String,
        ifMatch: String,
        idempotencyKey: String,
        recipientId: String
    ): OwnerApiResult<HandoffResponseWire> {
        val json =
            handoffRequestAdapter.toJson(
                HandoffRequestWire(
                    recipientId = recipientId,
                    acknowledgement = "handoff_confirmed_v1"
                )
            )
        return send(
            method = OwnerApiRequest.Method.POST,
            path = "/api/v1/tasks/${enc(taskId)}/handoff",
            clazz = HandoffResponseWire::class.java,
            jsonBody = json,
            headers =
            mapOf(
                "Content-Type" to "application/json",
                "If-Match" to ifMatch,
                "Idempotency-Key" to idempotencyKey
            )
        )
    }

    private suspend fun mutate(
        taskId: String,
        action: String,
        etag: String,
        jsonBody: String?
    ): OwnerApiResult<OwnerTask> {
        val headers =
            buildMap {
                put("If-Match", etag)
                if (jsonBody != null) {
                    put("Content-Type", "application/json")
                }
            }
        return mapTask(
            send(
                method = OwnerApiRequest.Method.POST,
                path = "/api/v1/tasks/${enc(taskId)}/$action",
                clazz = TaskWire::class.java,
                jsonBody = jsonBody,
                headers = headers
            )
        )
    }

    private fun mapTask(result: OwnerApiResult<TaskWire>): OwnerApiResult<OwnerTask> =
        when (result) {
            is OwnerApiResult.Success -> OwnerApiResult.Success(result.value.toOwnerTask())
            OwnerApiResult.Unauthorized -> OwnerApiResult.Unauthorized
            OwnerApiResult.Connectivity -> OwnerApiResult.Connectivity
            OwnerApiResult.NotConfigured -> OwnerApiResult.NotConfigured
            is OwnerApiResult.HttpError -> result
            is OwnerApiResult.Unexpected -> result
        }

    private fun enc(value: String): String = java.net.URLEncoder.encode(
        value,
        Charsets.UTF_8.name()
    )

    companion object {
        fun newIdempotencyKey(): String = "handoff-${UUID.randomUUID()}"
    }
}

data class TaskListPage(
    val items: List<OwnerTask>,
    val nextCursor: String?
)
