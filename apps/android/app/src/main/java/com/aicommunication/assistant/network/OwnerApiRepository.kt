package com.aicommunication.assistant.network

/**
 * Base repository for future Owner APIs (A9.1).
 *
 * Subclasses add endpoint-specific methods; they must not open separate OkHttp stacks.
 * No Task business logic lives here.
 */
abstract class OwnerApiRepository(
    protected val executor: OwnerApiExecutor
) {
    protected suspend fun <T> get(
        path: String,
        clazz: Class<T>,
        headers: Map<String, String> = emptyMap()
    ): OwnerApiResult<T> = executor.execute(
        OwnerApiRequest(
            method = OwnerApiRequest.Method.GET,
            path = path,
            headers = headers
        ),
        clazz
    )

    protected suspend fun <T> send(
        method: OwnerApiRequest.Method,
        path: String,
        clazz: Class<T>,
        jsonBody: String? = null,
        headers: Map<String, String> = emptyMap()
    ): OwnerApiResult<T> = executor.execute(
        OwnerApiRequest(
            method = method,
            path = path,
            headers = headers,
            jsonBody = jsonBody
        ),
        clazz
    )
}
