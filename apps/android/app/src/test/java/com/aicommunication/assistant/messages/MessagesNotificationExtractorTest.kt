package com.aicommunication.assistant.messages

import android.app.Application
import android.app.Notification
import android.app.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class MessagesNotificationExtractorTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun extract_readsDocumentedNotificationFieldsOnly() {
        val person = Person.Builder().setName("Ada").build()
        val notification =
            Notification.Builder(context, "messages")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Ada")
                .setContentText("Can you call me")
                .setStyle(
                    Notification.MessagingStyle(person)
                        .setGroupConversation(false)
                        .addMessage("Can you call me", 1_700_000_000_000L, person)
                )
                .build()

        val observed =
            MessagesNotificationExtractor.extract(
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES,
                notificationKey = "key-1",
                notificationId = 7,
                postTimeMs = 1_700_000_000_000L,
                notification = notification
            )

        assertEquals(GoogleMessagesPackages.GOOGLE_MESSAGES, observed.packageName)
        assertEquals("key-1", observed.notificationKey)
        assertEquals(7, observed.notificationId)
        assertEquals("Ada", observed.title)
        assertEquals("Can you call me", observed.text)
        assertEquals(false, observed.isGroupConversation)
        assertEquals(false, observed.messagingStyleIsGroup)
        assertTrue(observed.messagingStylePresent)
        assertEquals(1, observed.messagingStyleSenderCount)
        assertEquals("Can you call me", observed.latestMessageText)
        assertFalse(observed.isGroupSummary)
        assertTrue(observed.extraKeys.contains(Notification.EXTRA_TITLE))
        assertTrue(observed.extraKeys.contains(Notification.EXTRA_TEXT))
    }

    @Test
    fun extract_marksGroupSummaryAndAbsentGroupExtra() {
        val notification =
            Notification.Builder(context, "messages")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("3 messages")
                .setGroup("thread")
                .setGroupSummary(true)
                .build()

        val observed =
            MessagesNotificationExtractor.extract(
                packageName = GoogleMessagesPackages.GOOGLE_MESSAGES,
                notificationKey = "summary",
                notificationId = 1,
                postTimeMs = 1L,
                notification = notification
            )

        assertTrue(observed.isGroupSummary)
        assertNull(observed.isGroupConversation)
        assertFalse(observed.messagingStylePresent)
    }
}
