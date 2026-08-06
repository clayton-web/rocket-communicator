package com.aicommunication.assistant.network

import com.aicommunication.assistant.contracts.models.Session

/**
 * Owner session API via the shared networking layer (A9.1).
 *
 * Canonical probe remains `GET /api/v1/session` (D145). No Task routes.
 */
class SessionOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    suspend fun fetchSession(): OwnerApiResult<Session> =
        get(path = "/api/v1/session", clazz = Session::class.java)
}
