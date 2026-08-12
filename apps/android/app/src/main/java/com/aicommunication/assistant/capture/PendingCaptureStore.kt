package com.aicommunication.assistant.capture

import android.content.Context
import android.content.SharedPreferences
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
 *
 * Production persists only through EncryptedSharedPreferences. If AndroidKeyStore-backed storage
 * cannot be established, the store fails closed: no pending capture is kept, and raw capture text
 * is never written to ordinary SharedPreferences. Tests inject a preference implementation via
 * [forTests]; that seam is not a runtime plaintext fallback.
 */
class PendingCaptureStore private constructor(
    private val prefs: SharedPreferences
) {
    constructor(context: Context) : this(openEncryptedPreferences(context.applicationContext))

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

        /** Test-only seam: never used by the production Context constructor. */
        internal fun forTests(prefs: SharedPreferences) = PendingCaptureStore(prefs)

        /**
         * Production encrypted-preferences path. [createEncrypted] exists so tests can exercise
         * success and initialization-failure without a runtime plaintext fallback.
         */
        internal fun openEncryptedPreferences(
            context: Context,
            createEncrypted: (Context) -> SharedPreferences = { createEncryptedPreferences(it) }
        ): SharedPreferences {
            return try {
                createEncrypted(context)
            } catch (_: Exception) {
                FailClosedSharedPreferences
            }
        }

        private fun createEncryptedPreferences(context: Context): SharedPreferences =
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
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

/**
 * In-memory no-op preferences used when encrypted storage cannot be created. Writes are discarded
 * and reads miss, so raw capture text never reaches a backing file.
 */
private object FailClosedSharedPreferences : SharedPreferences {
    override fun getAll(): MutableMap<String, *> = mutableMapOf<String, Any>()

    override fun getString(key: String?, defValue: String?): String? = defValue

    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        defValues

    override fun getInt(key: String?, defValue: Int): Int = defValue

    override fun getLong(key: String?, defValue: Long): Long = defValue

    override fun getFloat(key: String?, defValue: Float): Float = defValue

    override fun getBoolean(key: String?, defValue: Boolean): Boolean = defValue

    override fun contains(key: String?): Boolean = false

    override fun edit(): SharedPreferences.Editor = FailClosedEditor

    override fun registerOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?
    ) = Unit

    override fun unregisterOnSharedPreferenceChangeListener(
        listener: SharedPreferences.OnSharedPreferenceChangeListener?
    ) = Unit
}

private object FailClosedEditor : SharedPreferences.Editor {
    override fun putString(key: String?, value: String?): SharedPreferences.Editor = this

    override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor =
        this

    override fun putInt(key: String?, value: Int): SharedPreferences.Editor = this

    override fun putLong(key: String?, value: Long): SharedPreferences.Editor = this

    override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = this

    override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = this

    override fun remove(key: String?): SharedPreferences.Editor = this

    override fun clear(): SharedPreferences.Editor = this

    override fun commit(): Boolean = false

    override fun apply() = Unit
}
