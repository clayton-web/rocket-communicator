package com.aicommunication.assistant.messages

/**
 * Derived structural facts about [StatusBarNotification.key] for the debug shape probe.
 *
 * Diagnostic-only. Must not be used for eligibility, local item identity, networking,
 * Review request contents, or a replacement occurrence identifier. Never stores the raw
 * key, tag, or compared private values.
 *
 * Expected platform shape is `userId|packageName|id|tag|uid`, but unexpected segment
 * counts fail closed instead of throwing.
 */
enum class MessagesNotificationKeyTagPresence(val debugLabel: String) {
    EMPTY_OR_NULL("empty_or_null"),
    PRESENT("present"),
    UNKNOWN("unknown")
}

enum class MessagesNotificationKeyTagClass(val debugLabel: String) {
    EMPTY("empty"),
    NUMERIC("numeric"),
    UUID_LIKE("uuid_like"),
    OPAQUE_ALPHANUMERIC("opaque_alphanumeric"),
    OTHER("other")
}

enum class MessagesNotificationKeyTagLengthBucket(val debugLabel: String) {
    ZERO("0"),
    ONE_TO_EIGHT("1_8"),
    NINE_TO_SIXTEEN("9_16"),
    SEVENTEEN_TO_THIRTY_TWO("17_32"),
    THIRTY_THREE_TO_SIXTY_FOUR("33_64"),
    SIXTY_FIVE_PLUS("65_plus"),
    UNKNOWN("unknown")
}

internal data class MessagesNotificationKeyStructure(
    val keySegmentCount: Int,
    val keyPackageSegmentMatchesObservedPackage: Boolean,
    val keyTagPresence: MessagesNotificationKeyTagPresence,
    val keyTagClass: MessagesNotificationKeyTagClass,
    val keyTagLengthBucket: MessagesNotificationKeyTagLengthBucket,
    val keyTagEqualsSenderDisplayValue: Boolean,
    val keyTagEqualsTitleOrConversationTitle: Boolean,
    val keyTagEqualsPlainTextBody: Boolean
) {
    companion object {
        private const val EXPECTED_SEGMENT_COUNT = 5
        private const val PACKAGE_SEGMENT_INDEX = 1
        private const val TAG_SEGMENT_INDEX = 3
        private val UUID_LIKE =
            Regex(
                "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            )
        private val NUMERIC = Regex("^[0-9]+$")
        private val OPAQUE_ALPHANUMERIC = Regex("^[A-Za-z0-9._:~-]+$")

        fun from(observation: MessagesNotificationObservation): MessagesNotificationKeyStructure =
            analyze(
                key = observation.notificationKey,
                packageName = observation.packageName,
                senderDisplayValue = observation.singlePersonName,
                title = observation.title,
                conversationTitle = observation.conversationTitle,
                plainTextBodies =
                listOf(
                    observation.text,
                    observation.bigText,
                    observation.latestMessageText
                )
            )

        fun analyze(
            key: String,
            packageName: String,
            senderDisplayValue: String? = null,
            title: String? = null,
            conversationTitle: String? = null,
            plainTextBodies: List<String?> = emptyList()
        ): MessagesNotificationKeyStructure {
            return try {
                analyzeUnsafe(
                    key = key,
                    packageName = packageName,
                    senderDisplayValue = senderDisplayValue,
                    title = title,
                    conversationTitle = conversationTitle,
                    plainTextBodies = plainTextBodies
                )
            } catch (_: RuntimeException) {
                unavailable()
            }
        }

        fun unavailable(): MessagesNotificationKeyStructure {
            return MessagesNotificationKeyStructure(
                keySegmentCount = 0,
                keyPackageSegmentMatchesObservedPackage = false,
                keyTagPresence = MessagesNotificationKeyTagPresence.UNKNOWN,
                keyTagClass = MessagesNotificationKeyTagClass.OTHER,
                keyTagLengthBucket = MessagesNotificationKeyTagLengthBucket.UNKNOWN,
                keyTagEqualsSenderDisplayValue = false,
                keyTagEqualsTitleOrConversationTitle = false,
                keyTagEqualsPlainTextBody = false
            )
        }

        private fun analyzeUnsafe(
            key: String,
            packageName: String,
            senderDisplayValue: String?,
            title: String?,
            conversationTitle: String?,
            plainTextBodies: List<String?>
        ): MessagesNotificationKeyStructure {
            if (key.isEmpty()) {
                return unavailable().copy(keySegmentCount = 0)
            }
            val segments = key.split('|')
            val segmentCount = segments.size
            val packageMatches =
                segmentCount == EXPECTED_SEGMENT_COUNT &&
                    segments.getOrNull(PACKAGE_SEGMENT_INDEX) == packageName
            if (segmentCount != EXPECTED_SEGMENT_COUNT) {
                return unavailable().copy(
                    keySegmentCount = segmentCount,
                    keyPackageSegmentMatchesObservedPackage = false
                )
            }
            val tag = segments[TAG_SEGMENT_INDEX]
            if (isAbsentTag(tag)) {
                return MessagesNotificationKeyStructure(
                    keySegmentCount = segmentCount,
                    keyPackageSegmentMatchesObservedPackage = packageMatches,
                    keyTagPresence = MessagesNotificationKeyTagPresence.EMPTY_OR_NULL,
                    keyTagClass = MessagesNotificationKeyTagClass.EMPTY,
                    keyTagLengthBucket = MessagesNotificationKeyTagLengthBucket.ZERO,
                    keyTagEqualsSenderDisplayValue = false,
                    keyTagEqualsTitleOrConversationTitle = false,
                    keyTagEqualsPlainTextBody = false
                )
            }
            return MessagesNotificationKeyStructure(
                keySegmentCount = segmentCount,
                keyPackageSegmentMatchesObservedPackage = packageMatches,
                keyTagPresence = MessagesNotificationKeyTagPresence.PRESENT,
                keyTagClass = classifyTag(tag),
                keyTagLengthBucket = lengthBucket(tag.length),
                keyTagEqualsSenderDisplayValue = equalsAny(tag, listOf(senderDisplayValue)),
                keyTagEqualsTitleOrConversationTitle =
                equalsAny(tag, listOf(title, conversationTitle)),
                keyTagEqualsPlainTextBody = equalsAny(tag, plainTextBodies)
            )
        }

        private fun isAbsentTag(tag: String): Boolean = tag.isEmpty() || tag == "null"

        private fun classifyTag(tag: String): MessagesNotificationKeyTagClass {
            return when {
                NUMERIC.matches(tag) -> MessagesNotificationKeyTagClass.NUMERIC
                UUID_LIKE.matches(tag) -> MessagesNotificationKeyTagClass.UUID_LIKE
                OPAQUE_ALPHANUMERIC.matches(tag) ->
                    MessagesNotificationKeyTagClass.OPAQUE_ALPHANUMERIC
                else -> MessagesNotificationKeyTagClass.OTHER
            }
        }

        private fun lengthBucket(length: Int): MessagesNotificationKeyTagLengthBucket {
            return when {
                length <= 0 -> MessagesNotificationKeyTagLengthBucket.ZERO
                length <= 8 -> MessagesNotificationKeyTagLengthBucket.ONE_TO_EIGHT
                length <= 16 -> MessagesNotificationKeyTagLengthBucket.NINE_TO_SIXTEEN
                length <= 32 -> MessagesNotificationKeyTagLengthBucket.SEVENTEEN_TO_THIRTY_TWO
                length <= 64 -> MessagesNotificationKeyTagLengthBucket.THIRTY_THREE_TO_SIXTY_FOUR
                else -> MessagesNotificationKeyTagLengthBucket.SIXTY_FIVE_PLUS
            }
        }

        private fun equalsAny(tag: String, values: List<String?>): Boolean =
            values.any { value -> !value.isNullOrEmpty() && value == tag }
    }
}
