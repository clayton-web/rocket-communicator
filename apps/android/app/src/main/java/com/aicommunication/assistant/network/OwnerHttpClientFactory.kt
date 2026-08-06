package com.aicommunication.assistant.network

import com.aicommunication.assistant.BuildConfig
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

object OwnerHttpClientFactory {
    fun create(enableSafeLogging: Boolean = BuildConfig.DEBUG): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .addInterceptor(SafeHttpLogger(enabled = enableSafeLogging))
            .build()
}
