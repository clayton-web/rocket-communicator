package com.aicommunication.assistant.messages

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class MessagesManifestGuardTest {
    @Test
    fun listenerService_isDeclaredWithoutSmsOrTelephonyPermissions() {
        val context = RuntimeEnvironment.getApplication()
        val packageInfo =
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.GET_SERVICES or PackageManager.GET_PERMISSIONS
            )
        val requested = packageInfo.requestedPermissions.orEmpty().toSet()
        assertFalse(requested.contains(Manifest.permission.READ_SMS))
        assertFalse(requested.contains(Manifest.permission.RECEIVE_SMS))
        assertFalse(requested.contains(Manifest.permission.SEND_SMS))
        assertFalse(requested.any { it.contains("TELEPHONY", ignoreCase = true) })

        val listener =
            packageInfo.services.orEmpty().singleOrNull {
                it.name == GoogleMessagesNotificationListenerService::class.java.name
            }
        assertNotNull(listener)
        assertEquals(
            Manifest.permission.BIND_NOTIFICATION_LISTENER_SERVICE,
            listener!!.permission
        )
    }
}
