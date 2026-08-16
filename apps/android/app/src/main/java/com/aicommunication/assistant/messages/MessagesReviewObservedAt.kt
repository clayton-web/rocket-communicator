package com.aicommunication.assistant.messages

import java.time.Instant

/**
 * Converts the original device notification observation instant into the Review contract's
 * explicit-zoned ISO-8601 `observedAt`.
 *
 * Always derived from [MessagesReviewItem.postedAtMs] / [MessagesNotificationObservation.postTimeMs].
 * Never uses Review-click time or retry time.
 */
object MessagesReviewObservedAt {
    fun fromPostedAtMs(postedAtMs: Long): String = Instant.ofEpochMilli(postedAtMs).toString()
}
