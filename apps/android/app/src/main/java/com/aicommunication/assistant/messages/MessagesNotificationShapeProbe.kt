package com.aicommunication.assistant.messages

/**
 * Privacy-safe presence/shape record for Galaxy S24+ notification verification (D181).
 *
 * Records which extras and flags were present, plus derived StatusBarNotification.key
 * structure, never message bodies, phone numbers, raw keys, or tags.
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
    val packageAllowed: Boolean,
    val keySegmentCount: Int,
    val keyPackageSegmentMatchesObservedPackage: Boolean,
    val keyTagPresence: MessagesNotificationKeyTagPresence,
    val keyTagClass: MessagesNotificationKeyTagClass,
    val keyTagLengthBucket: MessagesNotificationKeyTagLengthBucket,
    val keyTagEqualsSenderDisplayValue: Boolean,
    val keyTagEqualsTitleOrConversationTitle: Boolean,
    val keyTagEqualsPlainTextBody: Boolean
) {
    fun debugLine(): String {
        val group =
            when (isGroupConversation) {
                true -> "true"
                false -> "false"
                null -> "absent"
            }
        val styleGroup =
            when (messagingStyleIsGroup) {
                true -> "true"
                false -> "false"
                null -> "absent"
            }
        return "keys=${extraKeys.joinToString(",")} " +
            "title=$hasTitle text=$hasText bigText=$hasBigText " +
            "people=$hasPeople/$peopleCount " +
            "groupExtra=$group groupSummary=$isGroupSummary " +
            "messaging=$messagingStylePresent messagingGroup=$styleGroup " +
            "senders=$messagingStyleSenderCount " +
            "picture=$hasPicture media=$hasMediaSession " +
            "nonTextMime=$hasNonTextMessageMime " +
            "template=${template ?: "absent"} category=${category ?: "absent"} " +
            "keySegments=$keySegmentCount " +
            "keyPackageSegmentMatchesObservedPackage=" +
            "$keyPackageSegmentMatchesObservedPackage " +
            "keyTagPresence=${keyTagPresence.debugLabel} " +
            "keyTagClass=${keyTagClass.debugLabel} " +
            "keyTagLengthBucket=${keyTagLengthBucket.debugLabel} " +
            "keyTagEqualsSenderDisplayValue=$keyTagEqualsSenderDisplayValue " +
            "keyTagEqualsTitleOrConversationTitle=$keyTagEqualsTitleOrConversationTitle " +
            "keyTagEqualsPlainTextBody=$keyTagEqualsPlainTextBody"
    }

    companion object {
        fun from(observation: MessagesNotificationObservation): MessagesNotificationShape {
            val key = MessagesNotificationKeyStructure.from(observation)
            return MessagesNotificationShape(
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
                packageAllowed = GoogleMessagesPackages.isAllowed(observation.packageName),
                keySegmentCount = key.keySegmentCount,
                keyPackageSegmentMatchesObservedPackage =
                key.keyPackageSegmentMatchesObservedPackage,
                keyTagPresence = key.keyTagPresence,
                keyTagClass = key.keyTagClass,
                keyTagLengthBucket = key.keyTagLengthBucket,
                keyTagEqualsSenderDisplayValue = key.keyTagEqualsSenderDisplayValue,
                keyTagEqualsTitleOrConversationTitle =
                key.keyTagEqualsTitleOrConversationTitle,
                keyTagEqualsPlainTextBody = key.keyTagEqualsPlainTextBody
            )
        }
    }
}

class MessagesNotificationShapeProbe(
    private val enabled: Boolean,
    private val maxShapes: Int = 10
) {
    private val lock = Any()
    private val shapes = ArrayDeque<MessagesNotificationShape>()

    fun record(observation: MessagesNotificationObservation) {
        if (!enabled) return
        record(MessagesNotificationShape.from(observation))
    }

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
