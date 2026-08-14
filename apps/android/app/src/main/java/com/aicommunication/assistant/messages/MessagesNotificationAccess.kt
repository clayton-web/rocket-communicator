package com.aicommunication.assistant.messages

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

interface MessagesNotificationAccess {
    fun isEnabled(): Boolean

    fun settingsIntent(): Intent
}

class AndroidMessagesNotificationAccess(
    private val context: Context
) : MessagesNotificationAccess {
    override fun isEnabled(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context)
            .contains(context.packageName)

    override fun settingsIntent(): Intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
