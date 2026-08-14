package com.aicommunication.assistant.messages

import android.app.Notification
import android.app.Person
import android.os.Build
import android.os.Bundle
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat

/**
 * Maps a platform notification onto [MessagesNotificationObservation].
 *
 * Uses only documented StatusBarNotification / Notification extras. Values are trimmed;
 * blank CharSequences become null. Does not reconstruct conversations or invent fields.
 */
object MessagesNotificationExtractor {
    fun extract(sbn: StatusBarNotification): MessagesNotificationObservation = extract(
        packageName = sbn.packageName.orEmpty(),
        notificationKey = sbn.key.orEmpty(),
        notificationId = sbn.id,
        postTimeMs = sbn.postTime,
        notification = sbn.notification
    )

    fun extract(
        packageName: String,
        notificationKey: String,
        notificationId: Int,
        postTimeMs: Long,
        notification: Notification
    ): MessagesNotificationObservation {
        val extras = notification.extras ?: Bundle()
        val extraKeys = extras.keySet().orEmpty().toSortedSet()
        val style =
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
        val messages = style?.messages.orEmpty()
        val senderLabels =
            messages.mapNotNull { message ->
                message.person?.name?.toString()?.trim()?.ifBlank { null }
            }.distinct()
        val people = peopleList(extras)

        return MessagesNotificationObservation(
            packageName = packageName,
            notificationKey = notificationKey,
            notificationId = notificationId,
            postTimeMs = postTimeMs,
            title = charSequence(extras, Notification.EXTRA_TITLE),
            text = charSequence(extras, Notification.EXTRA_TEXT),
            bigText = charSequence(extras, Notification.EXTRA_BIG_TEXT),
            conversationTitle = charSequence(extras, Notification.EXTRA_CONVERSATION_TITLE),
            category = notification.category,
            template = charSequence(extras, Notification.EXTRA_TEMPLATE),
            isGroupSummary =
            notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isGroupConversation =
            if (extras.containsKey(Notification.EXTRA_IS_GROUP_CONVERSATION)) {
                extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION)
            } else {
                null
            },
            peopleCount = people?.size,
            singlePersonName =
            people?.singleOrNull()?.name?.toString()?.trim()?.ifBlank { null },
            messagingStylePresent = style != null,
            messagingStyleIsGroup = style?.isGroupConversation,
            messagingStyleSenderCount = senderLabels.size.takeIf { style != null },
            latestMessageText =
            messages.lastOrNull()?.text?.toString()?.trim()?.ifBlank { null },
            hasPicture =
            extras.containsKey(Notification.EXTRA_PICTURE) ||
                extras.containsKey(Notification.EXTRA_PICTURE_ICON),
            hasMediaSession = extras.containsKey(Notification.EXTRA_MEDIA_SESSION),
            hasNonTextMessageMime =
            messages.any { message ->
                val mime = message.dataMimeType
                !mime.isNullOrBlank() && !mime.startsWith("text/")
            },
            extraKeys = extraKeys
        )
    }

    private fun charSequence(extras: Bundle, key: String): String? =
        extras.getCharSequence(key)?.toString()?.trim()?.ifBlank { null }

    private fun firstNonBlank(vararg values: String?): String? =
        values.firstOrNull { !it.isNullOrBlank() }?.trim()?.ifBlank { null }

    private fun peopleList(extras: Bundle): ArrayList<Person>? {
        if (!extras.containsKey(Notification.EXTRA_PEOPLE_LIST)) return null
        return if (Build.VERSION.SDK_INT >= 33) {
            extras.getParcelableArrayList(Notification.EXTRA_PEOPLE_LIST, Person::class.java)
        } else {
            @Suppress("DEPRECATION")
            extras.getParcelableArrayList(Notification.EXTRA_PEOPLE_LIST)
        }
    }
}
