package com.aicommunication.assistant.messages

enum class MessagesIneligibilityReason {
    PACKAGE_NOT_ALLOWLISTED,
    EMPTY_TEXT,
    MEDIA_ONLY,
    GROUP_OR_AMBIGUOUS,
    SUMMARY_OR_GROUPED,
    UNSUPPORTED_SHAPE,
    MISSING_SENDER,
    OTP_OR_FINANCIAL
}

sealed class MessagesEligibilityDecision {
    data class Eligible(
        val displayText: String,
        val senderLabel: String
    ) : MessagesEligibilityDecision()

    data class NotReviewable(
        val reason: MessagesIneligibilityReason
    ) : MessagesEligibilityDecision()
}

/**
 * Fail-closed eligibility for D181: one-to-one plain-text Google Messages only.
 *
 * One-to-one requires positive platform evidence. Title + text with no conversation
 * metadata is treated as ambiguous, not eligible. Title is never treated as a phone
 * number. SMS versus RCS is not inferred.
 */
object MessagesEligibility {
    fun classify(observation: MessagesNotificationObservation): MessagesEligibilityDecision {
        if (!GoogleMessagesPackages.isAllowed(observation.packageName)) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.PACKAGE_NOT_ALLOWLISTED
            )
        }
        if (observation.notificationKey.isBlank()) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.UNSUPPORTED_SHAPE
            )
        }
        if (observation.isGroupSummary) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.SUMMARY_OR_GROUPED
            )
        }
        if (isPositiveGroup(observation) || !isPositiveOneToOne(observation)) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.GROUP_OR_AMBIGUOUS
            )
        }
        val displayText =
            firstNonBlank(
                observation.text,
                observation.bigText,
                observation.latestMessageText
            )
        if (displayText == null) {
            val reason =
                if (looksLikeMedia(observation)) {
                    MessagesIneligibilityReason.MEDIA_ONLY
                } else {
                    MessagesIneligibilityReason.EMPTY_TEXT
                }
            return MessagesEligibilityDecision.NotReviewable(reason)
        }
        if (looksLikeMedia(observation)) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.MEDIA_ONLY
            )
        }
        val senderLabel =
            firstNonBlank(observation.singlePersonName, observation.title)
                ?: return MessagesEligibilityDecision.NotReviewable(
                    MessagesIneligibilityReason.MISSING_SENDER
                )
        if (
            MessagesSensitiveContent.isOtpOrFinancial(
                observation.title,
                observation.text,
                observation.bigText,
                observation.latestMessageText,
                observation.singlePersonName
            )
        ) {
            return MessagesEligibilityDecision.NotReviewable(
                MessagesIneligibilityReason.OTP_OR_FINANCIAL
            )
        }
        return MessagesEligibilityDecision.Eligible(
            displayText = displayText,
            senderLabel = senderLabel
        )
    }

    private fun isPositiveGroup(observation: MessagesNotificationObservation): Boolean =
        observation.isGroupConversation == true ||
            observation.messagingStyleIsGroup == true ||
            (observation.peopleCount != null && observation.peopleCount > 1) ||
            (
                observation.messagingStyleSenderCount != null &&
                    observation.messagingStyleSenderCount > 1
                )

    /**
     * Positive one-to-one evidence from Android extras / MessagingStyle.
     * Absence of group signals is not enough.
     */
    private fun isPositiveOneToOne(observation: MessagesNotificationObservation): Boolean =
        observation.isGroupConversation == false ||
            observation.messagingStyleIsGroup == false ||
            observation.peopleCount == 1

    private fun looksLikeMedia(observation: MessagesNotificationObservation): Boolean =
        observation.hasPicture ||
            observation.hasMediaSession ||
            observation.hasNonTextMessageMime

    private fun firstNonBlank(vararg values: String?): String? =
        values.firstOrNull { !it.isNullOrBlank() }
}
