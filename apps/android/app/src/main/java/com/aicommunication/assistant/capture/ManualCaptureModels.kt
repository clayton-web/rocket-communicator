package com.aicommunication.assistant.capture

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Wire DTOs for the S3.2 Owner manual-capture route (`POST /api/v1/manual-captures`, D170/D171).
 *
 * Runtime decoding only — not a second proposal model. The generated
 * [com.aicommunication.assistant.contracts.models.TaskSuggestion] tree carries the polymorphic
 * `TaskSummaryPoint` interface, which Moshi cannot decode without a custom adapter stack, so
 * proposal summary points reuse the existing [CaptureSummaryPointWire] shape already proven
 * against every OpenAPI summary-point variant.
 */
@JsonClass(generateAdapter = false)
data class ManualCaptureRequestWire(
    @Json(name = "rawInput")
    val rawInput: String,
    @Json(name = "capturedAt")
    val capturedAt: String,
    /** IANA zone id; contract-nullable, so Moshi omits it when unknown. */
    @Json(name = "timezone")
    val timezone: String? = null
)

@JsonClass(generateAdapter = false)
data class ManualCaptureResponseWire(
    @Json(name = "idempotentReplay")
    val idempotentReplay: Boolean,
    @Json(name = "interpretedAt")
    val interpretedAt: String,
    /** 0..10 canonical pending proposals; an empty list is truthful success, not a failure. */
    @Json(name = "taskSuggestions")
    val taskSuggestions: List<TaskSuggestionWire>
)

/**
 * Public proposal fields S3.3 needs: stable identity, status, displayable summary points, the
 * concurrency pair a later lifecycle slice must send back, and creation time. Advisory and
 * provenance fields the read-only result cannot act on are deliberately not modelled; Moshi
 * ignores them on decode.
 */
@JsonClass(generateAdapter = false)
data class TaskSuggestionWire(
    @Json(name = "id")
    val id: String,
    @Json(name = "status")
    val status: String,
    @Json(name = "summaryPoints")
    val summaryPoints: List<CaptureSummaryPointWire>,
    @Json(name = "version")
    val version: Int,
    @Json(name = "etag")
    val etag: String,
    @Json(name = "createdAt")
    val createdAt: String
)
