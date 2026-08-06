package com.aicommunication.assistant.auth

import com.aicommunication.assistant.contracts.models.AuthenticatedRole
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.SessionOwnerRepository
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OwnerSessionClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: OwnerSessionClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = buildClient(server.url("/").toString().trimEnd('/'), token = "access-token")
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun fetchSession_sendsBearerAndParsesSession() = runTest {
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

        val result = client.fetchSession("ignored-call-site-token")

        val request = server.takeRequest()
        assertEquals("Bearer access-token", request.getHeader("Authorization"))
        assertEquals("/api/v1/session", request.path)
        val success = result as OwnerSessionClient.ProbeResult.Success
        assertEquals("owner-1", success.session.ownerId)
        assertEquals("org-1", success.session.organizationId)
        assertEquals(AuthenticatedRole.owner, success.session.role)
        assertEquals("Ada", success.session.displayName)
    }

    @Test
    fun fetchSession_mapsUnauthorized() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401).setBody("""{"error":{"code":"UNAUTHORIZED"}}""")
        )
        assertEquals(
            OwnerSessionClient.ProbeResult.Unauthorized,
            client.fetchSession("bad")
        )
    }

    @Test
    fun fetchSession_mapsConnectivityWhenServerDown() = runTest {
        server.shutdown()
        val unreachable =
            buildClient(apiBaseUrl = "http://127.0.0.1:${server.port}", token = "token")
        assertTrue(
            unreachable.fetchSession("token") is OwnerSessionClient.ProbeResult.Connectivity
        )
    }

    private fun buildClient(apiBaseUrl: String, token: String): OwnerSessionClient {
        val executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(apiBaseUrl),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String = token

                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        return OwnerSessionClient(SessionOwnerRepository(executor))
    }
}
