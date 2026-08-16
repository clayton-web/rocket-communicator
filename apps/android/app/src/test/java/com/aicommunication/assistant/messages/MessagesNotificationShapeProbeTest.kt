package com.aicommunication.assistant.messages

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesNotificationShapeProbeTest {
    @Test
    fun disabledProbe_recordsNothing() {
        val probe = MessagesNotificationShapeProbe(enabled = false)
        probe.record(observation(notificationKey = structuralKey(tag = SYNTH_TAG)))
        probe.record(MessagesNotificationShape.from(observation()))
        assertTrue(probe.recent().isEmpty())
    }

    @Test
    fun enabledProbe_recordsPresenceNotContent() {
        val probe = MessagesNotificationShapeProbe(enabled = true, maxShapes = 2)
        val first =
            observation(
                title = "SECRET-NUMBER",
                text = "secret body",
                extraKeys = setOf("android.title", "android.text")
            )
        val second = observation(notificationKey = "k2", extraKeys = setOf("android.title"))
        probe.record(MessagesNotificationShape.from(first))
        probe.record(MessagesNotificationShape.from(second))
        probe.record(MessagesNotificationShape.from(observation(notificationKey = "k3")))

        val recent = probe.recent()
        assertEquals(2, recent.size)
        val line = recent.first().toString()
        assertFalse(line.contains("SECRET-NUMBER"))
        assertFalse(line.contains("secret body"))
        assertTrue(recent.first().hasTitle)
        assertTrue(recent[1].extraKeys.contains("android.title"))
    }

    @Test
    fun probeOutput_neverEmitsRawKeyOrTag() {
        val key = structuralKey(tag = SYNTH_TAG)
        val probe = MessagesNotificationShapeProbe(enabled = true)
        probe.record(
            observation(
                notificationKey = key,
                title = SYNTH_TITLE,
                text = SYNTH_BODY,
                conversationTitle = SYNTH_CONVERSATION,
                singlePersonName = SYNTH_SENDER
            )
        )
        val shape = probe.recent().single()
        val rendered = listOf(shape.toString(), shape.debugLine())
        rendered.forEach { text ->
            assertFalse(text.contains(key))
            assertFalse(text.contains(SYNTH_TAG))
            assertFalse(text.contains(SYNTH_SENDER))
            assertFalse(text.contains(SYNTH_TITLE))
            assertFalse(text.contains(SYNTH_CONVERSATION))
            assertFalse(text.contains(SYNTH_BODY))
        }
        assertEquals(5, shape.keySegmentCount)
        assertTrue(shape.keyPackageSegmentMatchesObservedPackage)
        assertEquals(MessagesNotificationKeyTagClass.OPAQUE_ALPHANUMERIC, shape.keyTagClass)
        assertEquals("opaque_alphanumeric", shape.keyTagClass.debugLabel)
    }

    @Test
    fun exactMatchBooleans_neverEchoComparedValues() {
        val key = structuralKey(tag = SYNTH_SENDER)
        val shape =
            MessagesNotificationShape.from(
                observation(
                    notificationKey = key,
                    singlePersonName = SYNTH_SENDER,
                    title = SYNTH_TITLE,
                    text = SYNTH_BODY
                )
            )
        assertTrue(shape.keyTagEqualsSenderDisplayValue)
        assertFalse(shape.keyTagEqualsTitleOrConversationTitle)
        assertFalse(shape.keyTagEqualsPlainTextBody)
        assertFalse(shape.debugLine().contains(SYNTH_SENDER))
        assertFalse(shape.toString().contains(SYNTH_SENDER))
        assertTrue(shape.debugLine().contains("keyTagEqualsSenderDisplayValue=true"))
    }

    @Test
    fun diagnostic_doesNotAffectEligibility() {
        val opaque =
            observation(notificationKey = structuralKey(tag = "tok_ab12"))
        val readable =
            observation(notificationKey = structuralKey(tag = "hello world"))
        val opaqueDecision = MessagesEligibility.classify(opaque)
        val readableDecision = MessagesEligibility.classify(readable)
        assertEquals(opaqueDecision, readableDecision)
        assertTrue(opaqueDecision is MessagesEligibilityDecision.Eligible)

        val probe = MessagesNotificationShapeProbe(enabled = true)
        probe.record(opaque)
        probe.record(readable)
        assertEquals(opaqueDecision, MessagesEligibility.classify(opaque))
        assertEquals(readableDecision, MessagesEligibility.classify(readable))
        assertEquals(
            MessagesNotificationKeyTagClass.OPAQUE_ALPHANUMERIC,
            probe.recent()[1].keyTagClass
        )
        assertEquals(MessagesNotificationKeyTagClass.OTHER, probe.recent()[0].keyTagClass)
    }

    @Test
    fun diagnostic_doesNotChangeLocalOccurrenceIdentity() {
        val observation = observation(notificationKey = structuralKey(tag = SYNTH_TAG))
        val store = MessagesLocalReviewStore(clock = { 1_700_000_100_000L })
        val probe = MessagesNotificationShapeProbe(enabled = true)
        MessagesNotificationIntake.handle(observation, store, probe)
        assertEquals(observation.notificationKey, store.snapshot.value.eligible.single().id)
        assertFalse(
            probe.recent().single().debugLine().contains(SYNTH_TAG)
        )
    }

    @Test
    fun releaseConstructionSite_gatesProbeOnBuildConfigDebug() {
        val root = androidAppRoot()
        val application =
            File(root, "src/main/java/com/aicommunication/assistant/AicaaApplication.kt").readText()
        assertTrue(
            application.contains("MessagesNotificationShapeProbe(enabled = BuildConfig.DEBUG)")
        )
        val eligibility =
            File(
                root,
                "src/main/java/com/aicommunication/assistant/messages/MessagesEligibility.kt"
            ).readText()
        val store =
            File(
                root,
                "src/main/java/com/aicommunication/assistant/messages/MessagesLocalReviewStore.kt"
            ).readText()
        val models =
            File(
                root,
                "src/main/java/com/aicommunication/assistant/messages/MessagesReviewModels.kt"
            ).readText()
        val repository =
            File(
                root,
                "src/main/java/com/aicommunication/assistant/messages/MessagesOwnerRepository.kt"
            ).readText()
        listOf(eligibility, store, models, repository).forEach { source ->
            assertFalse(source.contains("MessagesNotificationKeyStructure"))
            assertFalse(source.contains("keyTagClass"))
            assertFalse(source.contains("keySegmentCount"))
        }
    }

    private fun androidAppRoot(): File {
        var dir = File(System.getProperty("user.dir")!!)
        repeat(8) {
            val candidate = File(dir, "src/main/AndroidManifest.xml")
            if (candidate.exists()) return dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.exists()) return File(dir, "app")
            dir = dir.parentFile ?: return File(System.getProperty("user.dir")!!)
        }
        error("Could not locate apps/android/app from ${System.getProperty("user.dir")}")
    }
}

private const val SYNTH_TAG = "SYNTH_TAG_OPAQUE1"
private const val SYNTH_SENDER = "SYNTH_SENDER"
private const val SYNTH_TITLE = "SYNTH_TITLE"
private const val SYNTH_CONVERSATION = "SYNTH_CONVERSATION"
private const val SYNTH_BODY = "SYNTH_BODY_TEXT"
