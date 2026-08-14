package com.aicommunication.assistant.messages

/**
 * Narrow local observation of one Android notification.
 *
 * Fields are only those the platform Notification / StatusBarNotification APIs actually
 * expose. Title is a display label, not a canonical phone number. No SMS-versus-RCS
 * inference. Conversation identity is whatever Android provided; it is not treated as a
 * stable thread id.
 */
data class MessagesNotificationObservation(
    val packageName: String,
    val notificationKey: String,
    val notificationId: Int,
    val postTimeMs: Long,
    val title: String?,
    val text: String?,
    val bigText: String?,
    val conversationTitle: String?,
    val category: String?,
    val template: String?,
    val isGroupSummary: Boolean,
    val isGroupConversation: Boolean?,
    val peopleCount: Int?,
    val singlePersonName: String?,
    val messagingStylePresent: Boolean,
    val messagingStyleIsGroup: Boolean?,
    val messagingStyleSenderCount: Int?,
    val latestMessageText: String?,
    val hasPicture: Boolean,
    val hasMediaSession: Boolean,
    val hasNonTextMessageMime: Boolean,
    val extraKeys: Set<String>
)
