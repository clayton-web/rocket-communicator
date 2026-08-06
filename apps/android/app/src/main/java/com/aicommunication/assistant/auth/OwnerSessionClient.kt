package com.aicommunication.assistant.auth

import com.aicommunication.assistant.contracts.models.Session
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.SessionOwnerRepository

/**
 * A9.0 session-probe adapter over the A9.1 networking foundation.
 *
 * Auth restore continues to use [ProbeResult]; HTTP execution is centralized in
 * [SessionOwnerRepository] / [com.aicommunication.assistant.network.OwnerApiExecutor].
 */
class OwnerSessionClient(
    private val sessionRepository: SessionOwnerRepository
) {
    sealed class ProbeResult {
        data class Success(val session: Session) : ProbeResult()

        data object Unauthorized : ProbeResult()

        data object Connectivity : ProbeResult()

        data class Unexpected(val message: String) : ProbeResult()
    }

    /**
     * Access token is supplied by the shared [com.aicommunication.assistant.network.AccessTokenProvider]
     * inside the executor — the unused parameter is retained so existing call sites stay stable.
     */
    @Suppress("UNUSED_PARAMETER")
    suspend fun fetchSession(accessToken: String): ProbeResult =
        when (val result = sessionRepository.fetchSession()) {
            is OwnerApiResult.Success -> ProbeResult.Success(result.value)
            OwnerApiResult.Unauthorized -> ProbeResult.Unauthorized
            OwnerApiResult.Connectivity -> ProbeResult.Connectivity
            OwnerApiResult.NotConfigured ->
                ProbeResult.Unexpected("Owner API is not configured.")
            is OwnerApiResult.HttpError ->
                ProbeResult.Unexpected(result.message)
            is OwnerApiResult.Unexpected ->
                ProbeResult.Unexpected(result.message)
        }
}
