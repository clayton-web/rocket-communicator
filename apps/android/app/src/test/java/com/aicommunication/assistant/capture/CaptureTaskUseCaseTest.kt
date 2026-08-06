package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import com.aicommunication.assistant.network.ownerApiMoshi
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CaptureTaskUseCaseTest {
    private lateinit var server: MockWebServer
    private lateinit var useCase: CaptureTaskUseCase

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val executor =
            OwnerApiExecutor(
                apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
                httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
                tokenProvider =
                object : AccessTokenProvider {
                    override suspend fun currentAccessToken(): String? = "access-token"
                    override suspend fun refreshAccessToken(): String? = "access-token"
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        useCase = CaptureTaskUseCase(TaskOwnerRepository(executor))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun execute_rejectsBlankWithoutCallingServer() = runTest {
        val result = useCase.execute("   ")
        assertTrue(result is OwnerApiResult.Unexpected)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun execute_postsTrimmedConfirmedFact() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(201)
                .setBody(
                    """
                    {
                      "id": "task-1",
                      "etag": "etag-1",
                      "status": "active",
                      "summaryPoints": [
                        {
                          "id": "p1",
                          "kind": "confirmed_fact",
                          "label": "Captured",
                          "order": 0,
                          "value": "Follow up with Alex"
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )

        val result = useCase.execute("  Follow up with Alex  ")

        val success = result as OwnerApiResult.Success
        assertEquals("task-1", success.value.id)
        assertEquals("Follow up with Alex", success.value.displayTitle)

        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/v1/tasks", request.path)
        assertEquals("Bearer access-token", request.getHeader("Authorization"))

        val body =
            ownerApiMoshi().adapter(
                CaptureCreateRequest::class.java
            ).fromJson(request.body.readUtf8())
        requireNotNull(body)
        assertEquals(1, body.summaryPoints.size)
        val point = body.summaryPoints.single()
        assertEquals(CaptureTaskUseCase.KIND_CONFIRMED_FACT, point.kind)
        assertEquals(CaptureTaskUseCase.LABEL_CAPTURED, point.label)
        assertEquals(0, point.order)
        assertEquals("Follow up with Alex", point.value)
        assertTrue(point.id.isNotBlank())
    }
}
