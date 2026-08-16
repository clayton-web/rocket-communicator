package com.aicommunication.assistant.messages

import com.aicommunication.assistant.capture.TaskSuggestionWire
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Hand-written Messages Review wire DTOs (D181).
 *
 * Generated [com.aicommunication.assistant.contracts.models.MessagesReviewResponse] embeds the
 * polymorphic [com.aicommunication.assistant.contracts.models.TaskSuggestion] tree, which Moshi
 * cannot decode without a custom adapter stack. Review proposals therefore reuse the existing
 * [TaskSuggestionWire] shape already proven against Gmail Review and manual capture.
 *
 * Request body is the committed contract: `sourceOccurrenceId`, `selectedText`, `observedAt`.
 * Sender, phone, title, organization, source kind, and account are not sent.
 */
@JsonClass(generateAdapter = false)
data class MessagesReviewRequestWire(
    @Json(name = "sourceOccurrenceId")
    val sourceOccurrenceId: String,
    @Json(name = "selectedText")
    val selectedText: String,
    @Json(name = "observedAt")
    val observedAt: String
)

@JsonClass(generateAdapter = false)
data class MessagesReviewResponseWire(
    @Json(name = "idempotentReplay")
    val idempotentReplay: Boolean,
    @Json(name = "interpretedAt")
    val interpretedAt: String,
    /** 0..10 canonical pending proposals; an empty list is truthful success, not a failure. */
    @Json(name = "taskSuggestions")
    val taskSuggestions: List<TaskSuggestionWire>
)

/** Successful 0..N Messages Review result handed to the existing S5 proposal-review surface. */
data class MessagesReviewReady(
    val sourceText: String,
    val proposals: List<TaskSuggestionWire>
)

/**
 * In-memory retry identity for one explicit Review with Rocket attempt.
 *
 * Survives configuration change with the ViewModel. Process death drops it: persisting
 * [selectedText] would create a durable local message-body archive, which D181 forbids.
 */
internal data class MessagesReviewAttempt(
    val sourceOccurrenceId: String,
    val selectedText: String,
    val observedAt: String,
    val idempotencyKey: String
)
