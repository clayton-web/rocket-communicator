package com.aicommunication.assistant.messages

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MessagesReviewItem(
    val id: String,
    val senderLabel: String,
    val text: String,
    val postedAtMs: Long
)

data class MessagesFilteredItem(
    val id: String,
    val reason: MessagesIneligibilityReason,
    val senderLabel: String?,
    val postedAtMs: Long
)

data class MessagesLocalSnapshot(
    val eligible: List<MessagesReviewItem> = emptyList(),
    val filtered: List<MessagesFilteredItem> = emptyList(),
    val listenerError: String? = null
)

/**
 * Device-local recent Google Messages review list (D181 first slice).
 *
 * In-memory and bounded. Process-death persistence is not used: Android may terminate or
 * recreate the process, and [onListenerConnected] then repopulates from currently active
 * notifications. Persisting dismissed notifications would create a local SMS archive,
 * which D181 forbids.
 *
 * Bounds: at most [MAX_ITEMS] combined eligible+filtered items; items older than [MAX_AGE_MS]
 * are dropped. Duplicates are keyed by notification key and replace in place. No network,
 * no proposal persistence, no server upload, no Recipient access.
 */
class MessagesLocalReviewStore(
    private val maxItems: Int = MAX_ITEMS,
    private val maxAgeMs: Long = MAX_AGE_MS,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {
    private val lock = Any()
    private val eligible = LinkedHashMap<String, MessagesReviewItem>()
    private val filtered = LinkedHashMap<String, MessagesFilteredItem>()
    private val _snapshot = MutableStateFlow(MessagesLocalSnapshot())
    val snapshot: StateFlow<MessagesLocalSnapshot> = _snapshot.asStateFlow()

    fun record(
        observation: MessagesNotificationObservation,
        decision: MessagesEligibilityDecision
    ) {
        synchronized(lock) {
            val id = observation.notificationKey
            when (decision) {
                is MessagesEligibilityDecision.Eligible -> {
                    filtered.remove(id)
                    eligible[id] =
                        MessagesReviewItem(
                            id = id,
                            senderLabel = decision.senderLabel,
                            text = decision.displayText,
                            postedAtMs = observation.postTimeMs
                        )
                }
                is MessagesEligibilityDecision.NotReviewable -> {
                    if (decision.reason == MessagesIneligibilityReason.PACKAGE_NOT_ALLOWLISTED) {
                        return
                    }
                    eligible.remove(id)
                    val hideContent =
                        decision.reason == MessagesIneligibilityReason.OTP_OR_FINANCIAL
                    filtered[id] =
                        MessagesFilteredItem(
                            id = id,
                            reason = decision.reason,
                            senderLabel =
                            if (hideContent) {
                                null
                            } else {
                                firstNonBlank(
                                    observation.singlePersonName,
                                    observation.title
                                )
                            },
                            postedAtMs = observation.postTimeMs
                        )
                }
            }
            pruneLocked()
            publishLocked()
        }
    }

    fun setListenerError(message: String?) {
        synchronized(lock) {
            _snapshot.value = _snapshot.value.copy(listenerError = message)
        }
    }

    fun clear() {
        synchronized(lock) {
            eligible.clear()
            filtered.clear()
            _snapshot.value = MessagesLocalSnapshot()
        }
    }

    private fun pruneLocked() {
        val cutoff = clock() - maxAgeMs
        eligible.entries.removeAll { it.value.postedAtMs < cutoff }
        filtered.entries.removeAll { it.value.postedAtMs < cutoff }
        val combined =
            (
                eligible.values.map { it.id to it.postedAtMs } +
                    filtered.values.map { it.id to it.postedAtMs }
                )
                .sortedBy { it.second }
        val overflow = combined.size - maxItems
        if (overflow <= 0) return
        combined.take(overflow).forEach { (id, _) ->
            eligible.remove(id)
            filtered.remove(id)
        }
    }

    private fun publishLocked() {
        _snapshot.value =
            MessagesLocalSnapshot(
                eligible = eligible.values.sortedByDescending { it.postedAtMs },
                filtered = filtered.values.sortedByDescending { it.postedAtMs },
                listenerError = _snapshot.value.listenerError
            )
    }

    private fun firstNonBlank(vararg values: String?): String? =
        values.firstOrNull { !it.isNullOrBlank() }

    companion object {
        const val MAX_ITEMS = 25
        const val MAX_AGE_MS = 24L * 60L * 60L * 1000L
    }
}
