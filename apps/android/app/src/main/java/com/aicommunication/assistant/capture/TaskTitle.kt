package com.aicommunication.assistant.capture

/**
 * Presentation title for a captured Task (A9.2).
 *
 * Mirrors the web rule in `apps/web/lib/presentation/task-title.ts` (D116 — shared rules,
 * not shared UI code): first non-empty summary point text, truncated; fallback to short id.
 */
fun deriveCapturedTaskTitle(taskId: String, summaryPoints: List<CaptureSummaryPointWire>?): String {
    val fromPoints =
        summaryPoints
            ?.asSequence()
            ?.map { point ->
                val valueText = point.value?.trim().orEmpty()
                if (valueText.isNotEmpty()) valueText else point.label.trim()
            }
            ?.firstOrNull { it.isNotEmpty() }

    if (fromPoints != null) {
        return if (fromPoints.length <= 120) fromPoints else fromPoints.take(120)
    }

    val shortId = taskId.take(8)
    return "Task $shortId"
}
