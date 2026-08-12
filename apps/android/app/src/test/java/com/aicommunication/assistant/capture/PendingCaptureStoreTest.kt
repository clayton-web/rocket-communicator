package com.aicommunication.assistant.capture

import android.app.Application
import android.content.Context
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Durable pending manual-capture retry state (S3.3, D171): single slot, 24-hour ceiling,
 * fail-closed reads, and no raw capture text in any stringified form.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class PendingCaptureStoreTest {
    private lateinit var store: PendingCaptureStore

    private val createdAt = "2026-08-12T15:00:00Z"
    private val createdAtMs = Instant.parse(createdAt).toEpochMilli()

    @Before
    fun setUp() {
        store = PendingCaptureStore(RuntimeEnvironment.getApplication())
        store.clear()
    }

    private fun operation(
        key: String = "capture-11111111-1111-1111-1111-111111111111",
        rawInput: String = "Call the roofer about the leak",
        capturedAt: String = "2026-08-12T15:00:00.123Z",
        timezone: String? = "America/Los_Angeles",
        version: Int = PendingCaptureStore.VERSION
    ) = PendingCaptureOperation(
        version = version,
        idempotencyKey = key,
        rawInput = rawInput,
        capturedAt = capturedAt,
        timezone = timezone,
        createdAt = createdAt
    )

    @Test
    fun savesAndReadsBackTheFullTupleUnchanged() {
        val saved = operation()
        store.write(saved)

        val restored = requireNotNull(store.read(createdAtMs))
        assertEquals(saved.idempotencyKey, restored.idempotencyKey)
        assertEquals(saved.rawInput, restored.rawInput)
        assertEquals(saved.capturedAt, restored.capturedAt)
        assertEquals(saved.timezone, restored.timezone)
        assertEquals(saved.createdAt, restored.createdAt)
        assertEquals(PendingCaptureStore.VERSION, restored.version)
    }

    @Test
    fun clearRemovesThePendingCapture() {
        store.write(operation())
        store.clear()
        assertNull(store.read(createdAtMs))
    }

    @Test
    fun readIgnoresACaptureOlderThanTwentyFourHours() {
        store.write(operation())

        val justInside = createdAtMs + PendingCaptureStore.TTL_MS
        assertNotNull(store.read(justInside))

        val justOutside = createdAtMs + PendingCaptureStore.TTL_MS + 1
        assertNull(store.read(justOutside))
        // Expiry is not a transient view: the slot is released, so a stale clock cannot resurrect it.
        assertNull(store.read(createdAtMs))
    }

    @Test
    fun isExpiredTracksTheTwentyFourHourCeiling() {
        val pending = operation()
        assertFalse(store.isExpired(pending, createdAtMs + PendingCaptureStore.TTL_MS))
        assertTrue(store.isExpired(pending, createdAtMs + PendingCaptureStore.TTL_MS + 1))
    }

    @Test
    fun keepsOnlyOnePendingCapture() {
        store.write(operation(key = "capture-first", rawInput = "First draft"))
        store.write(operation(key = "capture-second", rawInput = "Second draft"))

        val restored = store.read(createdAtMs)!!
        assertEquals("capture-second", restored.idempotencyKey)
        assertEquals("Second draft", restored.rawInput)
    }

    @Test
    fun malformedStoredDataFailsClosed() {
        rawPrefs().edit().putString(PendingCaptureStore.KEY, "{ not json").apply()

        assertNull(store.read(createdAtMs))
        assertFalse(rawPrefs().contains(PendingCaptureStore.KEY))
    }

    @Test
    fun storedDataFromAnotherSchemaVersionFailsClosed() {
        store.write(operation(version = PendingCaptureStore.VERSION + 1))

        assertNull(store.read(createdAtMs))
        assertFalse(rawPrefs().contains(PendingCaptureStore.KEY))
    }

    @Test
    fun incompleteTupleFailsClosed() {
        store.write(operation(rawInput = "   "))
        assertNull(store.read(createdAtMs))

        store.write(operation(key = " "))
        assertNull(store.read(createdAtMs))
    }

    @Test
    fun stringifyingAPendingCaptureRedactsRawInput() {
        val pending = operation(rawInput = "Sensitive capture text about the Hartley invoice")

        val rendered = pending.toString()
        assertFalse(rendered.contains("Hartley"))
        assertTrue(rendered.contains("<redacted>"))
        // Retry identity is still diagnosable without the capture body.
        assertTrue(rendered.contains(pending.idempotencyKey))
        assertTrue(rendered.contains(pending.capturedAt))
    }

    private fun rawPrefs() = RuntimeEnvironment.getApplication()
        .getSharedPreferences(PendingCaptureStore.FILE_NAME, Context.MODE_PRIVATE)
}
