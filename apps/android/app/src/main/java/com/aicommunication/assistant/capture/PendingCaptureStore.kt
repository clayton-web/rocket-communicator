package com.aicommunication.assistant.capture

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.aicommunication.assistant.network.ownerApiMoshi
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import java.time.Instant

/**
 * Durable pending manual-capture operation (S3.3, D171) — capture analogue of
 * [com.aicommunication.assistant.tasks.PendingHandoffStore].
 *
 * Holds the frozen retry tuple for exactly one unresolved capture so an ambiguous failure or
 * process death can be retried with the identity S3.1/S3.2 idempotency requires. Device-local
 * only: one slot, 24-hour ceiling, no capture history, no offline queue, no background sending,
 * and no backend sync.
 */
class PendingCaptureStore(
    context: Context
) {
    private val prefs = createPreferences(context.applicationContext)
    private val adapter = ownerApiMoshi().adapter(PendingCaptureOperation::class.java)

    /** Current pending capture, or null when absent, unreadable, or past its 24-hour ceiling. */
    fun read(nowMs: Long = System.currentTimeMillis()): PendingCaptureOperation? {
        val raw = prefs.getString(KEY, null) ?: return null
        val operation =
            try {
                adapter.fromJson(raw)
            } catch (_: Exception) {
                null
            }
        if (operation == null || !operation.isUsable()) {
            clear()
            return null
        }
        if (isExpired(operation, nowMs)) {
            clear()
            return null
        }
        return operation
    }

    /** Replaces the single slot; a second capture never queues behind the first. */
    fun write(operation: PendingCaptureOperation) {
        prefs.edit().putString(KEY, adapter.toJson(operation)).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    fun isExpired(
        operation: PendingCaptureOperation,
        nowMs: Long = System.currentTimeMillis()
    ): Boolean {
        return try {
            val created = Instant.parse(operation.createdAt).toEpochMilli()
            nowMs - created > TTL_MS
        } catch (_: Exception) {
            true
        }
    }

    private fun PendingCaptureOperation.isUsable(): Boolean = version == VERSION &&
        idempotencyKey.isNotBlank() &&
        rawInput.isNotBlank() &&
        capturedAt.isNotBlank()

    companion object {
        internal const val FILE_NAME = "aicaa_capture_pending"
        internal const val KEY = "aicaa.capture.pending.v1"
        const val VERSION = 1
        const val TTL_MS = 24L * 60L * 60L * 1000L

        private fun createPreferences(context: Context) = try {
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (_: Exception) {
            // Robolectric / environments without AndroidKeyStore.
            context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)
        }
    }
}

/**
 * The frozen retry tuple plus the minimum store metadata local lifecycle needs. Every tuple field
 * is generated once at the submission boundary and reused verbatim on retry (D171).
 */
@JsonClass(generateAdapter = false)
data class PendingCaptureOperation(
    @Json(name = "version") val version: Int = PendingCaptureStore.VERSION,
    @Json(name = "idempotencyKey") val idempotencyKey: String,
    @Json(name = "rawInput") val rawInput: String,
    @Json(name = "capturedAt") val capturedAt: String,
    @Json(name = "timezone") val timezone: String? = null,
    /** Store-created instant; drives the 24-hour ceiling, never the request payload. */
    @Json(name = "createdAt") val createdAt: String
) {
    /** Raw capture text is sensitive and must never reach a log, crash report, or analytics. */
    override fun toString(): String =
        "PendingCaptureOperation(version=$version, idempotencyKey=$idempotencyKey, " +
            "capturedAt=$capturedAt, timezone=$timezone, createdAt=$createdAt, " +
            "rawInput=<redacted>)"
}
