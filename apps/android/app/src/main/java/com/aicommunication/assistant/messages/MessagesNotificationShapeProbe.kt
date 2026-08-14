package com.aicommunication.assistant.messages

/**
 * Privacy-safe presence/shape record for Galaxy S24+ notification verification (D181).
 *
 * Records which extras and flags were present, never message bodies or phone numbers.
 * Disabled in non-debug builds. Not uploaded, not logged, not an analytics event.
 */
data class MessagesNotificationShape(
    val extraKeys: List<String>,
    val hasTitle: Boolean,
    val hasText: Boolean,
    val hasBigText: Boolean,
    val hasConversationTitle: Boolean,
    val hasPeople: Boolean,
    val peopleCount: Int?,
    val isGroupConversation: Boolean?,
    val isGroupSummary: Boolean,
    val messagingStylePresent: Boolean,
    val messagingStyleIsGroup: Boolean?,
    val messagingStyleSenderCount: Int?,
    val hasPicture: Boolean,
    val hasMediaSession: Boolean,
    val hasNonTextMessageMime: Boolean,
    val template: String?,
    val category: String?,
    val packageAllowed: Boolean
) {
    companion object {
        fun from(observation: MessagesNotificationObservation): MessagesNotificationShape =
            MessagesNotificationShape(
                extraKeys = observation.extraKeys.sorted(),
                hasTitle = observation.title != null,
                hasText = observation.text != null,
                hasBigText = observation.bigText != null,
                hasConversationTitle = observation.conversationTitle != null,
                hasPeople = observation.peopleCount != null,
                peopleCount = observation.peopleCount,
                isGroupConversation = observation.isGroupConversation,
                isGroupSummary = observation.isGroupSummary,
                messagingStylePresent = observation.messagingStylePresent,
                messagingStyleIsGroup = observation.messagingStyleIsGroup,
                messagingStyleSenderCount = observation.messagingStyleSenderCount,
                hasPicture = observation.hasPicture,
                hasMediaSession = observation.hasMediaSession,
                hasNonTextMessageMime = observation.hasNonTextMessageMime,
                template = observation.template,
                category = observation.category,
                packageAllowed = GoogleMessagesPackages.isAllowed(observation.packageName)
            )
    }
}

class MessagesNotificationShapeProbe(
    private val enabled: Boolean,
    private val maxShapes: Int = 10
) {
    private val lock = Any()
    private val shapes = ArrayDeque<MessagesNotificationShape>()

    fun record(shape: MessagesNotificationShape) {
        if (!enabled) return
        synchronized(lock) {
            shapes.addFirst(shape)
            while (shapes.size > maxShapes) {
                shapes.removeLast()
            }
        }
    }

    fun recent(): List<MessagesNotificationShape> = synchronized(lock) { shapes.toList() }

    fun clear() {
        synchronized(lock) { shapes.clear() }
    }
}
