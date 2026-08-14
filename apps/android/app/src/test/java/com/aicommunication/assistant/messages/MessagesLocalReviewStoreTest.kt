package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesLocalReviewStoreTest {
    @Test
    fun eligibleItem_isRetainedAndDuplicateKeyReplaces() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val first = observation(text = "first")
        store.record(first, MessagesEligibility.classify(first))
        val updated = observation(text = "updated later")
        store.record(updated, MessagesEligibility.classify(updated))

        val snap = store.snapshot.value
        assertEquals(1, snap.eligible.size)
        assertEquals("updated later", snap.eligible.single().text)
        assertTrue(snap.filtered.isEmpty())
    }

    @Test
    fun otp_isStoredWithoutSenderOrBody() {
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val otp = observation(text = "Your verification code is 123456")
        store.record(otp, MessagesEligibility.classify(otp))

        val item = store.snapshot.value.filtered.single()
        assertEquals(MessagesIneligibilityReason.OTP_OR_FINANCIAL, item.reason)
        assertNull(item.senderLabel)
        assertTrue(store.snapshot.value.eligible.isEmpty())
    }

    @Test
    fun list_isBoundedAndDropsOldest() {
        var now = 1_700_000_000_000L
        val store = MessagesLocalReviewStore(maxItems = 2, clock = { now })
        val older = observation(notificationKey = "k1", postTimeMs = now - 2_000)
        val middle = observation(notificationKey = "k2", postTimeMs = now - 1_000)
        val newest = observation(notificationKey = "k3", postTimeMs = now)
        store.record(older, MessagesEligibility.classify(older))
        store.record(middle, MessagesEligibility.classify(middle))
        store.record(newest, MessagesEligibility.classify(newest))

        val ids = store.snapshot.value.eligible.map { it.id }
        assertEquals(listOf("k3", "k2"), ids)
    }

    @Test
    fun itemsOlderThanMaxAge_areDropped() {
        val now = 1_700_000_000_000L
        val store =
            MessagesLocalReviewStore(
                maxAgeMs = 1_000L,
                clock = { now }
            )
        val stale = observation(notificationKey = "stale", postTimeMs = now - 5_000)
        val fresh = observation(notificationKey = "fresh", postTimeMs = now)
        store.record(stale, MessagesEligibility.classify(stale))
        store.record(fresh, MessagesEligibility.classify(fresh))

        assertEquals(listOf("fresh"), store.snapshot.value.eligible.map { it.id })
    }

    @Test
    fun nonAllowlistedPackage_isNotStored() {
        val store = MessagesLocalReviewStore()
        val other = observation(packageName = "com.google.android.gm")
        store.record(other, MessagesEligibility.classify(other))
        assertTrue(store.snapshot.value.eligible.isEmpty())
        assertTrue(store.snapshot.value.filtered.isEmpty())
    }
}
