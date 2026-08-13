package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.contracts.models.SetTaskReminderRequest
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiRequest
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.ownerApiMoshi

/**
 * Owner reminder APIs via the shared A9.1 networking stack (S6.2 / D177 / D178).
 *
 * PUT/DELETE require the reminder-resource ETag as `If-Match`, never the Task ETag.
 * Deadline writes omit `advanceEnabled` so the server default/preserve rules apply.
 * Preference writes send the explicit D178 boolean.
 */
class ReminderOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    private val setRequestAdapter = ownerApiMoshi().adapter(SetTaskReminderRequest::class.java)

    suspend fun getReminder(taskId: String): OwnerApiResult<TaskReminderWire> =
        get(path(taskId), TaskReminderWire::class.java)

    suspend fun setDueDate(
        taskId: String,
        reminderEtag: String,
        dueLocalDate: String
    ): OwnerApiResult<TaskReminderWire> = putReminder(
        taskId = taskId,
        reminderEtag = reminderEtag,
        request = SetTaskReminderRequest(dueLocalDate = dueLocalDate)
    )

    suspend fun setAdvanceEnabled(
        taskId: String,
        reminderEtag: String,
        dueLocalDate: String,
        advanceEnabled: Boolean
    ): OwnerApiResult<TaskReminderWire> = putReminder(
        taskId = taskId,
        reminderEtag = reminderEtag,
        request =
        SetTaskReminderRequest(
            dueLocalDate = dueLocalDate,
            advanceEnabled = advanceEnabled
        )
    )

    private suspend fun putReminder(
        taskId: String,
        reminderEtag: String,
        request: SetTaskReminderRequest
    ): OwnerApiResult<TaskReminderWire> {
        val json = setRequestAdapter.toJson(request)
        return send(
            method = OwnerApiRequest.Method.PUT,
            path = path(taskId),
            clazz = TaskReminderWire::class.java,
            jsonBody = json,
            headers =
            mapOf(
                "Content-Type" to "application/json",
                "If-Match" to reminderEtag
            )
        )
    }

    suspend fun clearDueDate(
        taskId: String,
        reminderEtag: String
    ): OwnerApiResult<TaskReminderWire> = send(
        method = OwnerApiRequest.Method.DELETE,
        path = path(taskId),
        clazz = TaskReminderWire::class.java,
        jsonBody = null,
        headers = mapOf("If-Match" to reminderEtag)
    )

    private fun path(taskId: String): String = "/api/v1/tasks/${enc(taskId)}/reminder"

    private fun enc(value: String): String = java.net.URLEncoder.encode(
        value,
        Charsets.UTF_8.name()
    )
}
