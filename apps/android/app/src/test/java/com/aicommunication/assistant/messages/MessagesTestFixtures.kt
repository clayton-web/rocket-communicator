package com.aicommunication.assistant.messages

internal fun observation(
    packageName: String = GoogleMessagesPackages.GOOGLE_MESSAGES,
    notificationKey: String = "0|${GoogleMessagesPackages.GOOGLE_MESSAGES}|1|null|0",
    notificationId: Int = 1,
    postTimeMs: Long = 1_700_000_000_000L,
    title: String? = "Ada",
    text: String? = "Can you call me tomorrow",
    bigText: String? = null,
    conversationTitle: String? = null,
    category: String? = null,
    template: String? = null,
    isGroupSummary: Boolean = false,
    isGroupConversation: Boolean? = false,
    peopleCount: Int? = 1,
    singlePersonName: String? = "Ada",
    messagingStylePresent: Boolean = true,
    messagingStyleIsGroup: Boolean? = false,
    messagingStyleSenderCount: Int? = 1,
    latestMessageText: String? = null,
    hasPicture: Boolean = false,
    hasMediaSession: Boolean = false,
    hasNonTextMessageMime: Boolean = false,
    extraKeys: Set<String> = setOf("android.title", "android.text")
): MessagesNotificationObservation {
    return MessagesNotificationObservation(
        packageName = packageName,
        notificationKey = notificationKey,
        notificationId = notificationId,
        postTimeMs = postTimeMs,
        title = title,
        text = text,
        bigText = bigText,
        conversationTitle = conversationTitle,
        category = category,
        template = template,
        isGroupSummary = isGroupSummary,
        isGroupConversation = isGroupConversation,
        peopleCount = peopleCount,
        singlePersonName = singlePersonName,
        messagingStylePresent = messagingStylePresent,
        messagingStyleIsGroup = messagingStyleIsGroup,
        messagingStyleSenderCount = messagingStyleSenderCount,
        latestMessageText = latestMessageText,
        hasPicture = hasPicture,
        hasMediaSession = hasMediaSession,
        hasNonTextMessageMime = hasNonTextMessageMime,
        extraKeys = extraKeys
    )
}

internal class FakeMessagesNotificationAccess(
    var enabled: Boolean,
    var settingsOpened: Int = 0
) : MessagesNotificationAccess {
    override fun isEnabled(): Boolean = enabled

    override fun settingsIntent() = android.content.Intent("test.messages.access").also {
        settingsOpened += 1
    }
}
