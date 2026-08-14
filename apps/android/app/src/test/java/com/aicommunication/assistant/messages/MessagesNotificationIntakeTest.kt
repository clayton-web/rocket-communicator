package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesNotificationIntakeTest {
    @Test
    fun nonMessagesPackage_isIgnoredAndNotProbed() {
        val store = MessagesLocalReviewStore()
        val probe = MessagesNotificationShapeProbe(enabled = true)
        MessagesNotificationIntake.handle(
            observation(packageName = "com.google.android.gm"),
            store,
            probe
        )
        assertTrue(store.snapshot.value.eligible.isEmpty())
        assertTrue(store.snapshot.value.filtered.isEmpty())
        assertTrue(probe.recent().isEmpty())
    }

    @Test
    fun eligibleMessages_areStoredAndShapedWithoutClaimingPhoneNumbers() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val probe = MessagesNotificationShapeProbe(enabled = true)
        MessagesNotificationIntake.handle(
            observation(title = "+15555550100", singlePersonName = null),
            store,
            probe
        )

        val item = store.snapshot.value.eligible.single()
        assertEquals("+15555550100", item.senderLabel)
        val shape = probe.recent().single()
        assertTrue(shape.hasTitle)
        assertTrue(shape.packageAllowed)
        assertEquals(false, shape.isGroupConversation)
    }

    @Test
    fun ambiguousGroup_isFilteredNotEligible() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val probe = MessagesNotificationShapeProbe(enabled = true)
        MessagesNotificationIntake.handle(
            observation(
                isGroupConversation = null,
                peopleCount = null,
                messagingStyleIsGroup = null,
                messagingStylePresent = false
            ),
            store,
            probe
        )
        assertTrue(store.snapshot.value.eligible.isEmpty())
        assertEquals(
            MessagesIneligibilityReason.GROUP_OR_AMBIGUOUS,
            store.snapshot.value.filtered.single().reason
        )
        assertEquals(1, probe.recent().size)
    }
}
