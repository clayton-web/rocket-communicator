package com.aicommunication.assistant.messages

import android.app.Application
import android.content.ComponentName
import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class MessagesNotificationAccessTest {
    @Test
    fun isEnabled_isFalseUntilListenerPackageIsGranted() {
        val context = RuntimeEnvironment.getApplication()
        val access = AndroidMessagesNotificationAccess(context)
        assertFalse(access.isEnabled())

        Settings.Secure.putString(
            context.contentResolver,
            "enabled_notification_listeners",
            ComponentName(
                context,
                GoogleMessagesNotificationListenerService::class.java
            ).flattenToString()
        )
        assertTrue(access.isEnabled())
    }

    @Test
    fun settingsIntent_opensNotificationListenerSettings() {
        val intent = AndroidMessagesNotificationAccess(RuntimeEnvironment.getApplication())
            .settingsIntent()
        assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, intent.action)
    }
}
