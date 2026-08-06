package com.aicommunication.assistant.capture

import com.aicommunication.assistant.contracts.models.ErrorCode
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiResult
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TaskOwnerRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: TaskOwnerRepository

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
                    override suspend fun refreshAccessToken(): String? = null
                },
                connectivity = FixedConnectivityMonitor(validated = true)
            )
        repository = TaskOwnerRepository(executor)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun createCapturedTask_maps201ToCapturedTask() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(201)
                .setBody(
                    """
                    {
                      "id": "task-9",
                      "etag": "e1",
                      "status": "active",
                      "summaryPoints": [
                        {
                          "id": "p1",
                          "kind": "confirmed_fact",
                          "label": "Captured",
                          "order": 0,
                          "value": "Order lumber"
                        }
                      ]
                    }
                    """.trimIndent()
                )
        )

        val result =
            repository.createCapturedTask(
                CaptureCreateRequest(
                    summaryPoints =
                    listOf(
                        CaptureSummaryPointWire(
                            id = "p1",
                            kind = "confirmed_fact",
                            label = "Captured",
                            order = 0,
                            value = "Order lumber"
                        )
                    )
                )
            )

        val success = result as OwnerApiResult.Success
        assertEquals("task-9", success.value.id)
        assertEquals("e1", success.value.etag)
        assertEquals("Order lumber", success.value.displayTitle)
        assertEquals("POST", server.takeRequest().method)
    }

    @Test
    fun createCapturedTask_mapsUnauthorized() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setBody("""{"error":{"code":"UNAUTHORIZED","message":"Unauthorized."}}""")
        )

        val result =
            repository.createCapturedTask(
                CaptureCreateRequest(
                    summaryPoints =
                    listOf(
                        CaptureSummaryPointWire(
                            id = "p1",
                            kind = "confirmed_fact",
                            label = "Captured",
                            order = 0,
                            value = "x"
                        )
                    )
                )
            )

        assertEquals(OwnerApiResult.Unauthorized, result)
    }

    @Test
    fun createCapturedTask_mapsValidationError() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(400)
                .setBody(
                    """
                    {
                      "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "summaryPoints must contain between 1 and 20 points."
                      }
                    }
                    """.trimIndent()
                )
        )

        val result =
            repository.createCapturedTask(
                CaptureCreateRequest(summaryPoints = emptyList())
            )

        assertTrue(result is OwnerApiResult.HttpError)
        assertEquals(ErrorCode.VALIDATION_ERROR, (result as OwnerApiResult.HttpError).code)
    }
}
