package com.aicommunication.assistant.tasks

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Hand-written reminder-resource wire DTO for S6.2 / D178.
 *
 * Generated [com.aicommunication.assistant.contracts.models.TaskReminderState] nests schedule
 * enums Android does not need to round-trip. This DTO keeps the mutation fields: dedicated
 * reminder ETag, canonical `dueLocalDate`, D178 `advanceEnabled`, and the recorded D105
 * occurrence date. Extra JSON keys are ignored. Do not confuse [etag] with the Task ETag.
 */
@JsonClass(generateAdapter = false)
data class TaskReminderWire(
    @Json(name = "taskId") val taskId: String,
    @Json(name = "etag") val etag: String,
    @Json(name = "dueLocalDate") val dueLocalDate: String? = null,
    @Json(name = "state") val state: String? = null,
    @Json(name = "advanceEnabled") val advanceEnabled: Boolean? = null,
    @Json(name = "advance") val advance: TaskReminderAdvanceWire? = null
)

@JsonClass(generateAdapter = false)
data class TaskReminderAdvanceWire(
    @Json(name = "disposition") val disposition: String? = null,
    @Json(name = "occurrence") val occurrence: TaskReminderOccurrenceWire? = null
)

@JsonClass(generateAdapter = false)
data class TaskReminderOccurrenceWire(
    @Json(name = "localDate") val localDate: String? = null,
    @Json(name = "at") val at: String? = null
)
