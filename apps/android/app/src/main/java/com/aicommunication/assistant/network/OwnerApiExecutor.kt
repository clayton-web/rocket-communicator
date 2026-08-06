package com.aicommunication.assistant.network

import com.squareup.moshi.Moshi
import java.io.IOException
import java.lang.reflect.Type
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Centralized Owner API execution and response mapping (A9.1).
 *
 * Single networking path for authenticated Owner routes. Attaches Bearer JWT from
 * [AccessTokenProvider]; refreshes once on 401 when authentication is required.
 */
class OwnerApiExecutor(
    private val apiConfig: ApiConfig,
    private val httpClient: OkHttpClient,
    private val tokenProvider: AccessTokenProvider,
    private val connectivity: ConnectivityMonitor,
    private val moshi: Moshi = ownerApiMoshi()
) {
    suspend fun <T> execute(request: OwnerApiRequest, valueType: Type): OwnerApiResult<T> =
        withContext(Dispatchers.IO) {
            executeInternal(request, valueType, allowRefreshRetry = true)
        }

    suspend fun <T> execute(request: OwnerApiRequest, clazz: Class<T>): OwnerApiResult<T> =
        execute(request, clazz as Type)

    private suspend fun <T> executeInternal(
        request: OwnerApiRequest,
        valueType: Type,
        allowRefreshRetry: Boolean
    ): OwnerApiResult<T> {
        if (!apiConfig.isConfigured) {
            return OwnerApiResult.NotConfigured
        }
        if (!connectivity.isNetworkValidated()) {
            return OwnerApiResult.Connectivity
        }

        var accessToken: String? = null
        if (request.requiresAuthentication) {
            accessToken = tokenProvider.currentAccessToken()
            if (accessToken.isNullOrBlank()) {
                return OwnerApiResult.Unauthorized
            }
        }

        val httpRequest = buildHttpRequest(request, accessToken)
        return try {
            httpClient.newCall(httpRequest).execute().use { response ->
                val body = response.body?.string().orEmpty()
                when {
                    response.isSuccessful -> {
                        if (valueType == Unit::class.java || valueType == Void.TYPE) {
                            @Suppress("UNCHECKED_CAST")
                            return OwnerApiResult.Success(Unit as T)
                        }
                        if (body.isBlank()) {
                            return OwnerApiResult.Unexpected("Empty response body.")
                        }
                        val adapter = moshi.adapter<T>(valueType)
                        val parsed = adapter.fromJson(body)
                        if (parsed == null) {
                            OwnerApiResult.Unexpected("Response could not be parsed.")
                        } else {
                            OwnerApiResult.Success(parsed)
                        }
                    }
                    response.code == 401 && request.requiresAuthentication -> {
                        if (allowRefreshRetry) {
                            val refreshed = tokenProvider.refreshAccessToken()
                            if (!refreshed.isNullOrBlank()) {
                                return executeInternal(
                                    request,
                                    valueType,
                                    allowRefreshRetry = false
                                )
                            }
                        }
                        OwnerApiResult.Unauthorized
                    }
                    else -> {
                        val parsed = parseApiErrorBody(body, response.code)
                        OwnerApiResult.HttpError(
                            httpStatus = response.code,
                            code = parsed.code,
                            message = parsed.message,
                            requestId = parsed.requestId
                        )
                    }
                }
            }
        } catch (_: IOException) {
            OwnerApiResult.Connectivity
        } catch (error: Exception) {
            OwnerApiResult.Unexpected(error.message ?: "Unexpected networking failure.")
        }
    }

    private fun buildHttpRequest(request: OwnerApiRequest, accessToken: String?): Request {
        val builder =
            Request.Builder()
                .url(apiConfig.url(request.path))
                .header("Accept", "application/json")

        request.headers.forEach { (name, value) ->
            if (!name.equals("Authorization", ignoreCase = true)) {
                builder.header(name, value)
            }
        }

        if (accessToken != null) {
            builder.header("Authorization", "Bearer $accessToken")
        }

        val jsonMedia = "application/json; charset=utf-8".toMediaType()
        when (request.method) {
            OwnerApiRequest.Method.GET -> builder.get()
            OwnerApiRequest.Method.DELETE -> builder.delete()
            OwnerApiRequest.Method.POST ->
                builder.post((request.jsonBody ?: "").toRequestBody(jsonMedia))
            OwnerApiRequest.Method.PUT ->
                builder.put((request.jsonBody ?: "").toRequestBody(jsonMedia))
            OwnerApiRequest.Method.PATCH ->
                builder.patch((request.jsonBody ?: "").toRequestBody(jsonMedia))
        }
        return builder.build()
    }
}
