package com.aicommunication.assistant.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.russhwolf.settings.Settings
import com.russhwolf.settings.SharedPreferencesSettings

/**
 * Platform secure storage for Supabase session tokens (D146 / SECURITY_AND_PRIVACY).
 *
 * Uses EncryptedSharedPreferences (Keystore-backed). App backup remains disabled in the
 * manifest so credentials are not included in cloud backups.
 */
object SecureSessionSettings {
    private const val FILE_NAME = "aicaa_owner_session"

    fun create(context: Context): Settings {
        val prefs = createEncryptedPreferences(context.applicationContext)
        return SharedPreferencesSettings(prefs)
    }

    private fun createEncryptedPreferences(context: Context): SharedPreferences {
        val masterKey =
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

        return EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
}
