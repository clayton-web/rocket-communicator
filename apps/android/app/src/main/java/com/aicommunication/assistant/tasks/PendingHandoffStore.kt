package com.aicommunication.assistant.tasks

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.aicommunication.assistant.network.ownerApiMoshi
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import java.time.Instant

/**
 * Durable pending handoff operation (A9.3) — Android analogue of web sessionStorage pending op.
 * Retains original If-Match + Idempotency-Key for safe retry (D090 / D094 / D132).
 */
class PendingHandoffStore(
    context: Context
) {
    private val prefs = createPreferences(context.applicationContext)
    private val adapter = ownerApiMoshi().adapter(PendingHandoffOperation::class.java)

    fun read(taskId: String): PendingHandoffOperation? {
        val raw = prefs.getString(key(taskId), null) ?: return null
        return try {
            val op = adapter.fromJson(raw) ?: return null
            if (op.version != VERSION || op.acknowledgement != "handoff_confirmed_v1") {
                null
            } else {
                op
            }
        } catch (_: Exception) {
            null
        }
    }

    fun write(operation: PendingHandoffOperation) {
        prefs.edit().putString(key(operation.taskId), adapter.toJson(operation)).apply()
    }

    fun clear(taskId: String) {
        prefs.edit().remove(key(taskId)).apply()
    }

    fun isExpired(
        operation: PendingHandoffOperation,
        nowMs: Long = System.currentTimeMillis()
    ): Boolean {
        return try {
            val created = Instant.parse(operation.createdAt).toEpochMilli()
            nowMs - created > TTL_MS
        } catch (_: Exception) {
            true
        }
    }

    private fun key(taskId: String): String = "aicaa.handoff.pending.v1:$taskId"

    companion object {
        private const val FILE_NAME = "aicaa_handoff_pending"
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

@JsonClass(generateAdapter = false)
data class PendingHandoffOperation(
    @Json(name = "version") val version: Int = PendingHandoffStore.VERSION,
    @Json(name = "taskId") val taskId: String,
    @Json(name = "recipientId") val recipientId: String,
    @Json(name = "idempotencyKey") val idempotencyKey: String,
    @Json(name = "originalIfMatch") val originalIfMatch: String,
    @Json(name = "acknowledgement") val acknowledgement: String = "handoff_confirmed_v1",
    @Json(name = "createdAt") val createdAt: String,
    @Json(name = "lastOutcomeCategory") val lastOutcomeCategory: String? = null,
    @Json(name = "reconsentPending") val reconsentPending: Boolean = false
)
