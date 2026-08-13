package com.aicommunication.assistant.tasks

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
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ReminderOwnerRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: ReminderOwnerRepository

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        repository =
            ReminderOwnerRepository(
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
    fun getReminder_readsDedicatedReminderResource() = runTest {
        server.enqueue(json(200, reminderBody("\"task-reminder-t1-v0\"", dueLocalDate = null)))

        val result = repository.getReminder("t1") as OwnerApiResult.Success
        assertEquals("t1", result.value.taskId)
        assertEquals("\"task-reminder-t1-v0\"", result.value.etag)
        assertNull(result.value.dueLocalDate)
        assertNull(result.value.advanceEnabled)
        val request = server.takeRequest()
        assertEquals("GET", request.method)
        assertTrue(request.path!!.endsWith("/api/v1/tasks/t1/reminder"))
        assertNull(request.getHeader("If-Match"))
    }

    @Test
    fun setDueDate_putsDateOnlyBodyWithReminderEtag() = runTest {
        val reminderEtag = "\"task-reminder-t1-v0\""
        val taskEtag = "\"task-t1-v4\""
        server.enqueue(
            json(200, reminderBody("\"task-reminder-t1-v1\"", dueLocalDate = "2026-08-20"))
        )

        val result =
            repository.setDueDate("t1", reminderEtag, "2026-08-20") as OwnerApiResult.Success
        assertEquals("2026-08-20", result.value.dueLocalDate)
        assertEquals("\"task-reminder-t1-v1\"", result.value.etag)

        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertTrue(request.path!!.endsWith("/api/v1/tasks/t1/reminder"))
        assertEquals(reminderEtag, request.getHeader("If-Match"))
        assertNotEquals(taskEtag, request.getHeader("If-Match"))
        assertEquals("""{"dueLocalDate":"2026-08-20"}""", request.body.readUtf8())
    }

    @Test
    fun setAdvanceEnabled_putsPreferenceWithReminderEtag() = runTest {
        val reminderEtag = "\"task-reminder-t1-v1\""
        val taskEtag = "\"task-t1-v4\""
        server.enqueue(
            json(
                200,
                reminderBody(
                    "\"task-reminder-t1-v2\"",
                    dueLocalDate = "2026-08-21",
                    advanceEnabled = false,
                    disposition = "not_enabled",
                    occurrenceLocalDate = "2026-08-20"
                )
            )
        )

        val result =
            repository.setAdvanceEnabled("t1", reminderEtag, "2026-08-21", false)
                as OwnerApiResult.Success
        assertEquals(false, result.value.advanceEnabled)
        assertEquals("not_enabled", result.value.advance?.disposition)
        assertEquals("2026-08-21", result.value.dueLocalDate)

        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertTrue(request.path!!.endsWith("/api/v1/tasks/t1/reminder"))
        assertEquals(reminderEtag, request.getHeader("If-Match"))
        assertNotEquals(taskEtag, request.getHeader("If-Match"))
        assertEquals(
            """{"dueLocalDate":"2026-08-21","advanceEnabled":false}""",
            request.body.readUtf8()
        )
    }

    @Test
    fun clearDueDate_deletesWithReminderEtag() = runTest {
        val reminderEtag = "\"task-reminder-t1-v1\""
        val taskEtag = "\"task-t1-v4\""
        server.enqueue(json(200, reminderBody("\"task-reminder-t1-v2\"", dueLocalDate = null)))

        val result = repository.clearDueDate("t1", reminderEtag) as OwnerApiResult.Success
        assertNull(result.value.dueLocalDate)
        assertEquals("\"task-reminder-t1-v2\"", result.value.etag)

        val request = server.takeRequest()
        assertEquals("DELETE", request.method)
        assertTrue(request.path!!.endsWith("/api/v1/tasks/t1/reminder"))
        assertEquals(reminderEtag, request.getHeader("If-Match"))
        assertNotEquals(taskEtag, request.getHeader("If-Match"))
    }

    private fun json(code: Int, body: String) = MockResponse().setResponseCode(code).setBody(body)

    private fun reminderBody(
        etag: String,
        dueLocalDate: String?,
        advanceEnabled: Boolean? = null,
        disposition: String? = null,
        occurrenceLocalDate: String? = null
    ): String {
        val due = if (dueLocalDate == null) "null" else "\"$dueLocalDate\""
        val encodedEtag = etag.replace("\"", "\\\"")
        val enabled =
            when (advanceEnabled) {
                null -> "null"
                else -> advanceEnabled.toString()
            }
        val advance =
            if (disposition == null) {
                "null"
            } else {
                val occurrence =
                    if (occurrenceLocalDate == null) {
                        "null"
                    } else {
                        """{"localDate":"$occurrenceLocalDate","at":"2026-08-20T16:00:00.000Z"}"""
                    }
                """{"disposition":"$disposition","occurrence":$occurrence}"""
            }
        return """
            {
              "taskId": "t1",
              "etag": "$encodedEtag",
              "state": "active",
              "requiresOwnerAttention": false,
              "dueLocalDate": $due,
              "advanceEnabled": $enabled,
              "advance": $advance
            }
        """.trimIndent()
    }
}
