package com.aicommunication.assistant.capture

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Wire DTOs for A9.2 typed capture and A9.3 Task list/detail decoding.
 *
 * Generated [com.aicommunication.assistant.contracts.models.TaskSummaryPoint] is an awkward
 * polymorphic interface unsuitable for Moshi create/parse without a custom adapter stack.
 * These DTOs cover create bodies (value-bearing) and response shapes where some kinds
 * (`amount`, `deadline`, `missing_information`) omit `value` per the shared OpenAPI contract.
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
    val value: String? = null
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
