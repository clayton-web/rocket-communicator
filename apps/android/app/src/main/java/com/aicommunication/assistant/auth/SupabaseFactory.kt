package com.aicommunication.assistant.auth

import android.content.Context
import com.russhwolf.settings.Settings
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.ExternalAuthAction
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.auth.SettingsCodeVerifierCache
import io.github.jan.supabase.auth.SettingsSessionManager
import io.github.jan.supabase.createSupabaseClient

object SupabaseFactory {
    fun create(
        context: Context,
        config: AuthConfig,
        settings: Settings = SecureSessionSettings.create(context)
    ): SupabaseClient? {
        if (!config.isConfigured) {
            return null
        }

        return createSupabaseClient(
            supabaseUrl = config.supabaseUrl,
            supabaseKey = config.supabaseAnonKey
        ) {
            install(Auth) {
                scheme = AuthConfig.OAUTH_SCHEME
                host = AuthConfig.OAUTH_HOST
                flowType = FlowType.PKCE
                // A9.0 (D146): no background / lifecycle auto-refresh. Refresh only on
                // restore or natural authentication failure.
                alwaysAutoRefresh = false
                enableLifecycleCallbacks = false
                defaultExternalAuthAction = ExternalAuthAction.CustomTabs()
                sessionManager = SettingsSessionManager(settings)
                codeVerifierCache = SettingsCodeVerifierCache(settings)
            }
        }
    }
}
