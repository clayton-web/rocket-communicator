package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesNotificationKeyStructureTest {
    @Test
    fun fivePartKey_reportsSegmentCountAndPackageMatch() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "tok_ab12"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(5, structure.keySegmentCount)
        assertTrue(structure.keyPackageSegmentMatchesObservedPackage)
    }

    @Test
    fun packageSegmentMismatch_isFalse() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "tok_ab12", pkg = "com.example.other"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(5, structure.keySegmentCount)
        assertFalse(structure.keyPackageSegmentMatchesObservedPackage)
    }

    @Test
    fun nullTag_isEmpty() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "null"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(MessagesNotificationKeyTagPresence.EMPTY_OR_NULL, structure.keyTagPresence)
        assertEquals(MessagesNotificationKeyTagClass.EMPTY, structure.keyTagClass)
        assertEquals(MessagesNotificationKeyTagLengthBucket.ZERO, structure.keyTagLengthBucket)
        assertFalse(structure.keyTagEqualsSenderDisplayValue)
        assertFalse(structure.keyTagEqualsTitleOrConversationTitle)
        assertFalse(structure.keyTagEqualsPlainTextBody)
    }

    @Test
    fun emptyTagSegment_isEmpty() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = ""),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(MessagesNotificationKeyTagPresence.EMPTY_OR_NULL, structure.keyTagPresence)
        assertEquals(MessagesNotificationKeyTagClass.EMPTY, structure.keyTagClass)
        assertEquals(MessagesNotificationKeyTagLengthBucket.ZERO, structure.keyTagLengthBucket)
    }

    @Test
    fun numericTag_isNumeric() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "42"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(MessagesNotificationKeyTagPresence.PRESENT, structure.keyTagPresence)
        assertEquals(MessagesNotificationKeyTagClass.NUMERIC, structure.keyTagClass)
        assertEquals(
            MessagesNotificationKeyTagLengthBucket.ONE_TO_EIGHT,
            structure.keyTagLengthBucket
        )
    }

    @Test
    fun uuidShapedTag_isUuidLike() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = SYNTH_UUID),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(MessagesNotificationKeyTagClass.UUID_LIKE, structure.keyTagClass)
        assertEquals(
            MessagesNotificationKeyTagLengthBucket.THIRTY_THREE_TO_SIXTY_FOUR,
            structure.keyTagLengthBucket
        )
    }

    @Test
    fun opaqueIdentifierTag_isOpaque() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "tok_ab12"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(
            MessagesNotificationKeyTagClass.OPAQUE_ALPHANUMERIC,
            structure.keyTagClass
        )
        assertEquals(
            MessagesNotificationKeyTagLengthBucket.ONE_TO_EIGHT,
            structure.keyTagLengthBucket
        )
    }

    @Test
    fun humanReadableWhitespaceTag_isOther() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = "hello world"),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
            )
        assertEquals(MessagesNotificationKeyTagPresence.PRESENT, structure.keyTagPresence)
        assertEquals(MessagesNotificationKeyTagClass.OTHER, structure.keyTagClass)
        assertEquals(
            MessagesNotificationKeyTagLengthBucket.NINE_TO_SIXTEEN,
            structure.keyTagLengthBucket
        )
    }

    @Test
    fun malformedKey_failsClosedWithoutThrowing() {
        val samples =
            listOf(
                "",
                "only-one-segment",
                "0|${GoogleMessagesPackages.GOOGLE_MESSAGES}|1",
                "0|${GoogleMessagesPackages.GOOGLE_MESSAGES}|1|tok|1000|extra",
                "0|${GoogleMessagesPackages.GOOGLE_MESSAGES}|1|tag_with|pipe|1000"
            )
        samples.forEach { key ->
            val structure =
                MessagesNotificationKeyStructure.analyze(
                    key = key,
                    packageName = GoogleMessagesPackages.GOOGLE_MESSAGES
                )
            assertFalse(structure.keyPackageSegmentMatchesObservedPackage)
            assertEquals(MessagesNotificationKeyTagPresence.UNKNOWN, structure.keyTagPresence)
            assertEquals(MessagesNotificationKeyTagClass.OTHER, structure.keyTagClass)
            assertEquals(
                MessagesNotificationKeyTagLengthBucket.UNKNOWN,
                structure.keyTagLengthBucket
            )
            assertFalse(structure.keyTagEqualsSenderDisplayValue)
            assertFalse(structure.keyTagEqualsTitleOrConversationTitle)
            assertFalse(structure.keyTagEqualsPlainTextBody)
            val rendered = structure.toString()
            if (key.isNotEmpty()) {
                assertFalse(rendered.contains(key))
            }
            assertFalse(rendered.contains("tag_with"))
            assertFalse(rendered.contains("pipe"))
        }
    }

    @Test
    fun exactMatchBooleans_reportOnlyBooleansNeverComparedValues() {
        val structure =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = SYNTH_SENDER),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES,
                senderDisplayValue = SYNTH_SENDER,
                title = SYNTH_TITLE,
                conversationTitle = SYNTH_CONVERSATION,
                plainTextBodies = listOf(SYNTH_BODY)
            )
        assertTrue(structure.keyTagEqualsSenderDisplayValue)
        assertFalse(structure.keyTagEqualsTitleOrConversationTitle)
        assertFalse(structure.keyTagEqualsPlainTextBody)
        val rendered = structure.toString()
        assertFalse(rendered.contains(SYNTH_SENDER))
        assertFalse(rendered.contains(SYNTH_TITLE))
        assertFalse(rendered.contains(SYNTH_CONVERSATION))
        assertFalse(rendered.contains(SYNTH_BODY))
    }

    @Test
    fun titleConversationAndBodyExactMatches_areIndependentBooleans() {
        val titleMatch =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = SYNTH_TITLE),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES,
                senderDisplayValue = SYNTH_SENDER,
                title = SYNTH_TITLE,
                conversationTitle = SYNTH_CONVERSATION,
                plainTextBodies = listOf(SYNTH_BODY)
            )
        assertFalse(titleMatch.keyTagEqualsSenderDisplayValue)
        assertTrue(titleMatch.keyTagEqualsTitleOrConversationTitle)
        assertFalse(titleMatch.keyTagEqualsPlainTextBody)

        val bodyMatch =
            MessagesNotificationKeyStructure.analyze(
                key = structuralKey(tag = SYNTH_BODY),
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES,
                senderDisplayValue = SYNTH_SENDER,
                title = SYNTH_TITLE,
                plainTextBodies = listOf(SYNTH_BODY)
            )
        assertTrue(bodyMatch.keyTagEqualsPlainTextBody)
        assertFalse(bodyMatch.keyTagEqualsTitleOrConversationTitle)
    }

    @Test
    fun phoneComparisonField_isOmitted() {
        val names = MessagesNotificationKeyStructure::class.java.declaredFields.map { it.name }
        assertFalse(names.any { it.contains("phone", ignoreCase = true) })
        assertFalse(names.any { it.contains("number", ignoreCase = true) })
    }
}

private const val SYNTH_SENDER = "SYNTH_SENDER"
private const val SYNTH_TITLE = "SYNTH_TITLE"
private const val SYNTH_CONVERSATION = "SYNTH_CONVERSATION"
private const val SYNTH_BODY = "SYNTH_BODY_TEXT"
private const val SYNTH_UUID = "01234567-89ab-cdef-0123-456789abcdef"

internal fun structuralKey(
    tag: String,
    pkg: String = GoogleMessagesPackages.GOOGLE_MESSAGES,
    userId: String = "0",
    id: String = "1",
    uid: String = "1000"
): String = "$userId|$pkg|$id|$tag|$uid"
