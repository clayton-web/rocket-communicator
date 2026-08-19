package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.capture.TaskOwnerRepository
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TaskOwnerRepositoryA93Test {
    private lateinit var server: MockWebServer
    private lateinit var repository: TaskOwnerRepository

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository =
            TaskOwnerRepository(
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
            )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun listTasks_mapsOwnerWorkLabel() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "items": [
                        {
                          "id": "task-1",
                          "etag": "\"v1\"",
                          "status": "open",
                          "summaryPoints": [
                            {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
                          ]
                        }
                      ],
                      "nextCursor": null
                    }
                    """.trimIndent()
                )
        )

        val result = repository.listTasks() as OwnerApiResult.Success
        assertEquals(1, result.value.items.size)
        assertEquals("Buy paint", result.value.items[0].displayTitle)
        assertTrue(result.value.items[0].isOwnerWork)
        assertNull(result.value.nextCursor)
        assertEquals("GET", server.takeRequest().method)
    }

    @Test
    fun startTask_sendsIfMatch() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "task-1",
                      "etag": "\"v2\"",
                      "status": "in_progress",
                      "summaryPoints": [
                        {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
                      ]
                    }
                    """.trimIndent()
                )
        )

        val result = repository.startTask("task-1", "\"v1\"") as OwnerApiResult.Success
        assertEquals("in_progress", result.value.status)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("\"v1\"", request.getHeader("If-Match"))
        assertTrue(request.path!!.endsWith("/api/v1/tasks/task-1/start"))
    }

    @Test
    fun handoffTask_sendsIdempotencyAndAcknowledgement() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "task": {
                        "id": "task-1",
                        "etag": "\"v3\"",
                        "status": "open",
                        "summaryPoints": [
                          {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
                        ],
                        "assignment": {
                          "intendedRecipientEmail": "worker@example.com",
                          "deliveryStatus": "sent"
                        }
                      },
                      "deliveryPath": "assignment_email",
                      "deliveryStatus": "sent",
                      "recipient": {
                        "id": "rec-1",
                        "displayName": "Worker",
                        "email": "worker@example.com",
                        "active": true
                      },
                      "capabilityId": "cap-1",
                      "requiresSendReconsent": false,
                      "idempotentReplay": false
                    }
                    """.trimIndent()
                )
        )

        val result =
            repository.handoffTask(
                taskId = "task-1",
                ifMatch = "\"v2\"",
                idempotencyKey = "handoff-key-1",
                recipientId = "rec-1"
            ) as OwnerApiResult.Success

        assertEquals("sent", result.value.deliveryStatus)
        assertEquals("assignment_email", result.value.deliveryPath)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("\"v2\"", request.getHeader("If-Match"))
        assertEquals("handoff-key-1", request.getHeader("Idempotency-Key"))
        assertTrue(request.body.readUtf8().contains("handoff_confirmed_v1"))
    }

    @Test
    fun returnTaskToOwner_postsOwnerRouteWithIfMatchAndNoInventedBody() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(
                    """
                    {
                      "id": "task-1",
                      "etag": "\"v3\"",
                      "status": "in_progress",
                      "summaryPoints": [
                        {"id":"p1","kind":"confirmed_fact","label":"Captured","order":0,"value":"Buy paint"}
                      ]
                    }
                    """.trimIndent()
                )
        )

        val result = repository.returnTaskToOwner("task-1", "\"v2\"") as OwnerApiResult.Success

        assertEquals("task-1", result.value.id)
        assertFalse(result.value.isAssigned)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertTrue(request.path!!.endsWith("/api/v1/tasks/task-1/return-to-owner"))
        assertEquals("Bearer access-token", request.getHeader("Authorization"))
        assertEquals("\"v2\"", request.getHeader("If-Match"))
        assertNull(request.getHeader("Idempotency-Key"))
        assertEquals("{}", request.body.readUtf8())
        assertTrue(request.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals(1, server.requestCount)
    }
}
