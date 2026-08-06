package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.OwnerApiResult
import java.util.UUID

/**
 * Builds the default typed-capture create body and persists via [TaskOwnerRepository].
 *
 * Introduced because request shaping (confirmed_fact mapping, client UUID) is real logic —
 * not a speculative abstraction layer.
 */
open class CaptureTaskUseCase(
    private val repository: TaskOwnerRepository
) {
    open suspend fun execute(rawText: String): OwnerApiResult<CapturedTask> {
        val text = rawText.trim()
        if (text.isEmpty()) {
            return OwnerApiResult.Unexpected("Capture text is empty.")
        }

        val request =
            CaptureCreateRequest(
                summaryPoints =
                listOf(
                    CaptureSummaryPointWire(
                        id = UUID.randomUUID().toString(),
                        kind = KIND_CONFIRMED_FACT,
                        label = LABEL_CAPTURED,
                        order = 0,
                        value = text
                    )
                )
            )
        return repository.createCapturedTask(request)
    }

    companion object {
        const val KIND_CONFIRMED_FACT = "confirmed_fact"
        const val LABEL_CAPTURED = "Captured"
    }
}
