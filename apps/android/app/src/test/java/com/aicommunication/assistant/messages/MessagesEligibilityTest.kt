package com.aicommunication.assistant.messages

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesEligibilityTest {
    @Test
    fun eligiblePlainText_oneToOneMessagingStyle() {
        val decision = MessagesEligibility.classify(observation())
        val eligible = decision as MessagesEligibilityDecision.Eligible
        assertEquals("Can you call me tomorrow", eligible.displayText)
        assertEquals("Ada", eligible.senderLabel)
    }

    @Test
    fun emptyText_isRejected() {
        val decision =
            MessagesEligibility.classify(
                observation(text = null, bigText = null, latestMessageText = null)
            )
        assertEquals(
            MessagesIneligibilityReason.EMPTY_TEXT,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun mediaOnly_isRejectedEvenWhenCaptionExists() {
        val decision =
            MessagesEligibility.classify(observation(hasPicture = true, text = "look"))
        assertEquals(
            MessagesIneligibilityReason.MEDIA_ONLY,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun groupConversation_isRejected() {
        val decision =
            MessagesEligibility.classify(
                observation(isGroupConversation = true, peopleCount = 3)
            )
        assertEquals(
            MessagesIneligibilityReason.GROUP_OR_AMBIGUOUS,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun titleAndTextWithoutOneToOneEvidence_isAmbiguous() {
        val decision =
            MessagesEligibility.classify(
                observation(
                    isGroupConversation = null,
                    peopleCount = null,
                    singlePersonName = null,
                    messagingStylePresent = false,
                    messagingStyleIsGroup = null,
                    messagingStyleSenderCount = null
                )
            )
        assertEquals(
            MessagesIneligibilityReason.GROUP_OR_AMBIGUOUS,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun summaryNotification_isRejected() {
        val decision = MessagesEligibility.classify(observation(isGroupSummary = true))
        assertEquals(
            MessagesIneligibilityReason.SUMMARY_OR_GROUPED,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun missingSender_isRejected() {
        val decision =
            MessagesEligibility.classify(
                observation(title = null, singlePersonName = null)
            )
        assertEquals(
            MessagesIneligibilityReason.MISSING_SENDER,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun otp_isRejected() {
        val decision =
            MessagesEligibility.classify(
                observation(text = "Your verification code is 123456")
            )
        assertEquals(
            MessagesIneligibilityReason.OTP_OR_FINANCIAL,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun nonMessagesPackage_isRejected() {
        val decision =
            MessagesEligibility.classify(
                observation(packageName = "com.google.android.gm")
            )
        assertTrue(decision is MessagesEligibilityDecision.NotReviewable)
        assertEquals(
            MessagesIneligibilityReason.PACKAGE_NOT_ALLOWLISTED,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }

    @Test
    fun blankNotificationKey_isUnsupported() {
        val decision = MessagesEligibility.classify(observation(notificationKey = "  "))
        assertEquals(
            MessagesIneligibilityReason.UNSUPPORTED_SHAPE,
            (decision as MessagesEligibilityDecision.NotReviewable).reason
        )
    }
}
