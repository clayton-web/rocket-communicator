package com.aicommunication.assistant.capture

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Wire DTOs for A9.2 typed capture, A9.3 Task list/detail decoding, and S5.3 proposal edit.
 *
 * Generated [com.aicommunication.assistant.contracts.models.TaskSummaryPoint] is an awkward
 * polymorphic interface unsuitable for Moshi create/parse without a custom adapter stack.
 * These DTOs cover create bodies (value-bearing) and response shapes where some kinds
 * (`amount`, `deadline`, `missing_information`) omit `value` per the shared OpenAPI contract.
 *
 * Kind-specific fields are retained so S5.3 can send a lossless replace-array edit. Presence
 * on this model is not an edit authorization: S5.3 still changes only `value` wording.
 */
@JsonClass(generateAdapter = false)
data class CaptureCreateRequest(
    @Json(name = "summaryPoints")
    val summaryPoints: List<CaptureSummaryPointWire>
)

@JsonClass(generateAdapter = false)
data class CaptureSummaryPointWire(
    @Json(name = "id")
    val id: String,
    @Json(name = "kind")
    val kind: String,
    @Json(name = "label")
    val label: String,
    @Json(name = "order")
    val order: Int,
    /** Present for text-bearing kinds; absent/null for amount/deadline/missing_information. */
    @Json(name = "value")
    val value: String? = null,
    @Json(name = "amount")
    val amount: Double? = null,
    @Json(name = "currency")
    val currency: String? = null,
    @Json(name = "dueAt")
    val dueAt: String? = null,
    @Json(name = "localDate")
    val localDate: String? = null,
    @Json(name = "timezone")
    val timezone: String? = null,
    @Json(name = "missingItem")
    val missingItem: String? = null,
    @Json(name = "confidence")
    val confidence: Double? = null
)

@JsonClass(generateAdapter = false)
data class CaptureTaskResponse(
    @Json(name = "id")
    val id: String,
    @Json(name = "etag")
    val etag: String,
    @Json(name = "status")
    val status: String,
    @Json(name = "summaryPoints")
    val summaryPoints: List<CaptureSummaryPointWire>? = null
)

data class CapturedTask(
    val id: String,
    val etag: String,
    val status: String,
    val displayTitle: String
)
