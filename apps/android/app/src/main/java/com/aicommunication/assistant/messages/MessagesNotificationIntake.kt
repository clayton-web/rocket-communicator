package com.aicommunication.assistant.messages

import android.service.notification.StatusBarNotification

/**
 * Device-local Google Messages notification intake (D181 first slice).
 *
 * Allowlisted packages only. No network, no interpretation, no TaskSuggestion, no Task,
 * no server CommunicationEvent, no TemporaryCommunicationExcerpt, no Exclude Number.
 */
object MessagesNotificationIntake {
    fun onPosted(
        sbn: StatusBarNotification,
        store: MessagesLocalReviewStore,
        probe: MessagesNotificationShapeProbe
    ) {
        if (!GoogleMessagesPackages.isAllowed(sbn.packageName.orEmpty())) {
            return
        }
        handle(MessagesNotificationExtractor.extract(sbn), store, probe)
    }

    fun handle(
        observation: MessagesNotificationObservation,
        store: MessagesLocalReviewStore,
        probe: MessagesNotificationShapeProbe
    ) {
        if (!GoogleMessagesPackages.isAllowed(observation.packageName)) {
            return
        }
        probe.record(observation)
        store.record(observation, MessagesEligibility.classify(observation))
    }
}
