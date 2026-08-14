package com.aicommunication.assistant.messages

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.aicommunication.assistant.AicaaApplication

/**
 * Minimum NotificationListenerService authorized by D181.
 *
 * Receives eligible Google Messages notification events locally. Immediately ignores
 * packages outside [GoogleMessagesPackages]. Performs no network operation, no
 * interpretation, no server persistence, and no Task or proposal creation. Does not
 * request SMS or Telephony permissions. Rocket is not the default SMS handler.
 */
class GoogleMessagesNotificationListenerService : NotificationListenerService() {
    override fun onListenerConnected() {
        super.onListenerConnected()
        val deps = deps() ?: return
        deps.store.setListenerError(null)
        try {
            activeNotifications.orEmpty().forEach { sbn ->
                MessagesNotificationIntake.onPosted(sbn, deps.store, deps.probe)
            }
        } catch (_: SecurityException) {
            deps.store.setListenerError(LISTENER_ERROR)
        } catch (_: RuntimeException) {
            deps.store.setListenerError(LISTENER_ERROR)
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val deps = deps() ?: return
        try {
            MessagesNotificationIntake.onPosted(sbn, deps.store, deps.probe)
        } catch (_: RuntimeException) {
            deps.store.setListenerError(LISTENER_ERROR)
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
    }

    private fun deps(): ListenerDeps? {
        val app = application as? AicaaApplication ?: return null
        return ListenerDeps(app.messagesReviewStore, app.messagesShapeProbe)
    }

    private data class ListenerDeps(
        val store: MessagesLocalReviewStore,
        val probe: MessagesNotificationShapeProbe
    )

    companion object {
        const val LISTENER_ERROR = "listener_read_failed"
    }
}
