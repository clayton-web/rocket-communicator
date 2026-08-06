package com.aicommunication.assistant.capture

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Wire DTOs for A9.2 typed capture.
 *
 * Generated [com.aicommunication.assistant.contracts.models.TaskSummaryPoint] is an awkward
 * polymorphic interface unsuitable for Moshi create/parse without a custom adapter stack.
 * These DTOs match the production create body / confirmation fields only.
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
    @Json(name = "value")
    val value: String
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
