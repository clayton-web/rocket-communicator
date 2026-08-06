package com.aicommunication.assistant.network

import com.aicommunication.assistant.contracts.models.AuthenticatedRole
import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.contracts.models.Session
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OwnerApiExecutorTest {
    private lateinit var server: MockWebServer
    private lateinit var tokenProvider: FakeAccessTokenProvider
    private lateinit var executor: OwnerApiExecutor

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        tokenProvider = FakeAccessTokenProvider(token = "access-token")
        executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider = tokenProvider,
                connectivity = FixedConnectivityMonitor(validated = true)
            )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun execute_attachesBearerAndParsesSession() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "ownerId": "owner-1",
                      "organizationId": "org-1",
                      "role": "owner",
                      "displayName": "Ada"
                    }
                    """.trimIndent()
                )
        )

        val result =
            executor.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        val request = server.takeRequest()
        assertEquals("Bearer access-token", request.getHeader("Authorization"))
        assertEquals("/api/v1/session", request.path)
        val success = result as OwnerApiResult.Success
        assertEquals("owner-1", success.value.ownerId)
        assertEquals(AuthenticatedRole.owner, success.value.role)
    }

    @Test
    fun execute_mapsUnauthorizedAfterFailedRefresh() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setBody(
                    """
                    {
                      "error": {
                        "code": "UNAUTHORIZED",
                        "message": "Unauthorized.",
                        "requestId": "00000000-0000-0000-0000-000000000001"
                      }
                    }
                    """.trimIndent()
                )
        )
        tokenProvider.refreshToken = null

        val result =
            executor.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        assertEquals(OwnerApiResult.Unauthorized, result)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun execute_refreshesOnceOnUnauthorized() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setBody("""{"error":{"code":"UNAUTHORIZED"}}""")
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "ownerId": "owner-1",
                      "organizationId": "org-1",
                      "role": "owner"
                    }
                    """.trimIndent()
                )
        )
        tokenProvider.refreshToken = "refreshed-token"

        val result =
            executor.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        assertTrue(result is OwnerApiResult.Success)
        assertEquals(2, server.requestCount)
        assertEquals("Bearer access-token", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer refreshed-token", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun execute_mapsHttpErrorEnvelope() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setBody(
                    """
                    {
                      "error": {
                        "code": "NOT_FOUND",
                        "message": "Not found.",
                        "requestId": "11111111-1111-1111-1111-111111111111"
                      }
                    }
                    """.trimIndent()
                )
        )

        val result =
            executor.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        val error = result as OwnerApiResult.HttpError
        assertEquals(404, error.httpStatus)
        assertEquals(ErrorCode.NOT_FOUND, error.code)
        assertEquals("Not found.", error.message)
    }

    @Test
    fun execute_surfacesConnectivityWhenMonitorReportsOffline() = runTest {
        val offlineExecutor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider = tokenProvider,
                connectivity = FixedConnectivityMonitor(validated = false)
            )

        val result =
            offlineExecutor.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        assertEquals(OwnerApiResult.Connectivity, result)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun execute_surfacesConnectivityOnIOException() = runTest {
        server.shutdown()
        val unreachable =
            OwnerApiExecutor(
                apiConfig = ApiConfig("http://127.0.0.1:${server.port}"),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider = tokenProvider,
                connectivity = FixedConnectivityMonitor(validated = true)
            )

        val result =
            unreachable.execute(
                OwnerApiRequest(OwnerApiRequest.Method.GET, "/api/v1/session"),
                Session::class.java
            )

        assertEquals(OwnerApiResult.Connectivity, result)
    }

    private class FakeAccessTokenProvider(
        var token: String?,
        var refreshToken: String? = token
    ) : AccessTokenProvider {
        override suspend fun currentAccessToken(): String? = token

        override suspend fun refreshAccessToken(): String? {
            token = refreshToken
            return refreshToken
        }
    }
}
