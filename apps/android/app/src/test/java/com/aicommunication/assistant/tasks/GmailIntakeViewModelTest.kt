package com.aicommunication.assistant.tasks

import android.app.Application
import androidx.lifecycle.viewModelScope
import com.aicommunication.assistant.network.AccessTokenProvider
import com.aicommunication.assistant.network.ApiConfig
import com.aicommunication.assistant.network.FixedConnectivityMonitor
import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerHttpClientFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.job
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31], application = Application::class)
class GmailIntakeViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()

    private lateinit var application: Application
    private lateinit var server: MockWebServer
    private var sessionInvalidated = 0

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        application = RuntimeEnvironment.getApplication()
        sessionInvalidated = 0
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        server.shutdown()
    }

    @Test
    fun load_mapsIntakeItemsIntoReadyState() = runTest {
        enqueueIntake(itemJson("evt_1", "Please review"))
        val vm = viewModel()

        vm.load()
        vm.awaitSettled()

        val ready = vm.uiState.value as GmailIntakeUiState.Ready
        assertEquals(1, ready.items.size)
        assertEquals("evt_1", ready.items.single().id)
        assertEquals("Please review", ready.items.single().subject)
        assertNull(ready.selectedId)
        assertEquals("/api/v1/gmail/intake?limit=25", server.takeRequest().path)
    }

    @Test
    fun reviewWithRocket_postsSelectedCommunicationEventIdAndIdempotencyKey() = runTest {
        enqueueIntake(itemJson("evt_review_ok", "Quote revision"))
        enqueueReview(proposalReviewBody("sug-1", "Send the revised quote"))
        val vm = loadedAndSelected("evt_review_ok")

        vm.reviewWithRocket()
        vm.awaitSettled()

        assertEquals("/api/v1/gmail/intake?limit=25", server.takeRequest().path)
        val review = server.takeRequest()
        assertEquals("POST", review.method)
        assertEquals("/api/v1/gmail/reviews", review.path)
        assertNotNull(review.getHeader("Idempotency-Key"))
        assertTrue(review.getHeader("Idempotency-Key")!!.startsWith("gmail-review-"))
        assertTrue(review.body.readUtf8().contains("\"communicationEventId\":\"evt_review_ok\""))
        assertNotEquals("/api/v1/tasks", review.path)

        val result = requireNotNull(vm.openReviewResult.value)
        assertEquals("Quote revision", result.sourceText)
        assertEquals(1, result.proposals.size)
        assertEquals("sug-1", result.proposals.single().id)
    }

    @Test
    fun reviewWithRocket_zeroSuggestionsIsTruthfulSuccess() = runTest {
        enqueueIntake(itemJson("evt_empty", "Thinking out loud"))
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected("evt_empty")

        vm.reviewWithRocket()
        vm.awaitSettled()

        val result = requireNotNull(vm.openReviewResult.value)
        assertTrue(result.proposals.isEmpty())
        assertEquals("Thinking out loud", result.sourceText)
        server.takeRequest()
        assertEquals("/api/v1/gmail/reviews", server.takeRequest().path)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun reviewRetry_reusesTheSameIdempotencyKeyAfterDependencyUnavailable() = runTest {
        enqueueIntake(itemJson("evt_review_ok", "Quote revision"))
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected("evt_review_ok")

        vm.reviewWithRocket()
        vm.awaitSettled()
        val ready = vm.uiState.value as GmailIntakeUiState.Ready
        assertTrue(ready.canRetryReview)
        assertNull(vm.openReviewResult.value)

        vm.reviewWithRocket()
        vm.awaitSettled()

        assertEquals(3, server.requestCount)
        server.takeRequest()
        val firstKey = server.takeRequest().getHeader("Idempotency-Key")
        val retry = server.takeRequest()
        assertEquals(firstKey, retry.getHeader("Idempotency-Key"))
        assertEquals("/api/v1/gmail/reviews", retry.path)
        assertNotNull(vm.openReviewResult.value)
    }

    @Test
    fun reviewRetry_reusesTheSameIdempotencyKeyAfterLostUnexpectedResponse() = runTest {
        enqueueIntake(itemJson("evt_review_ok", "Quote revision"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{"))
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected("evt_review_ok")

        vm.reviewWithRocket()
        vm.awaitSettled()
        assertTrue((vm.uiState.value as GmailIntakeUiState.Ready).canRetryReview)

        vm.reviewWithRocket()
        vm.awaitSettled()

        server.takeRequest()
        val firstKey = server.takeRequest().getHeader("Idempotency-Key")
        assertEquals(firstKey, server.takeRequest().getHeader("Idempotency-Key"))
    }

    @Test
    fun aNewExplicitReviewAfterSuccessMintsAFreshKey() = runTest {
        enqueueIntake(itemJson("evt_review_ok", "Quote revision"))
        enqueueReview(emptyReviewBody)
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected("evt_review_ok")

        vm.reviewWithRocket()
        vm.awaitSettled()
        vm.consumeReviewResult()

        vm.reviewWithRocket()
        vm.awaitSettled()

        server.takeRequest()
        val firstKey = server.takeRequest().getHeader("Idempotency-Key")
        val secondKey = server.takeRequest().getHeader("Idempotency-Key")
        assertNotEquals(firstKey, secondKey)
    }

    @Test
    fun terminalNotFoundClearsTheAttemptSoTheNextReviewIsANewKey() = runTest {
        enqueueIntake(itemJson("evt_missing", "Gone"))
        enqueueError(404, "NOT_FOUND")
        enqueueReview(emptyReviewBody)
        val vm = loadedAndSelected("evt_missing")

        vm.reviewWithRocket()
        vm.awaitSettled()
        val failed = vm.uiState.value as GmailIntakeUiState.Ready
        assertFalse(failed.canRetryReview)
        assertNotNull(failed.reviewError)
        assertNull(vm.openReviewResult.value)

        vm.reviewWithRocket()
        vm.awaitSettled()

        server.takeRequest()
        val firstKey = server.takeRequest().getHeader("Idempotency-Key")
        val secondKey = server.takeRequest().getHeader("Idempotency-Key")
        assertNotEquals(firstKey, secondKey)
    }

    @Test
    fun dependencyUnavailable_doesNotCreateATaskOrOpenProposals() = runTest {
        enqueueIntake(itemJson("evt_review_ok", "Quote revision"))
        enqueueError(503, "DEPENDENCY_UNAVAILABLE")
        val vm = loadedAndSelected("evt_review_ok")

        vm.reviewWithRocket()
        vm.awaitSettled()

        assertNull(vm.openReviewResult.value)
        server.takeRequest()
        assertEquals("/api/v1/gmail/reviews", server.takeRequest().path)
        assertEquals(2, server.requestCount)
    }

    @Test
    fun reviewWithoutASelectionSendsNothing() = runTest {
        enqueueIntake(itemJson("evt_1", "Please review"))
        val vm = viewModel()
        vm.load()
        vm.awaitSettled()

        vm.reviewWithRocket()
        vm.awaitSettled()

        assertEquals(1, server.requestCount)
        assertEquals("/api/v1/gmail/intake?limit=25", server.takeRequest().path)
    }

    @Test
    fun load_unauthorizedInvalidatesSession() = runTest {
        enqueueError(401, "UNAUTHORIZED")
        val vm = viewModel()

        vm.load()
        vm.awaitSettled()

        assertTrue(vm.uiState.value is GmailIntakeUiState.Error)
        assertEquals(1, sessionInvalidated)
    }

    private suspend fun loadedAndSelected(id: String): GmailIntakeViewModel {
        val vm = viewModel()
        vm.load()
        vm.awaitSettled()
        vm.select(id)
        return vm
    }

    private suspend fun GmailIntakeViewModel.awaitSettled() {
        viewModelScope.coroutineContext.job.children.toList().forEach { child -> child.join() }
    }

    private fun viewModel(): GmailIntakeViewModel = GmailIntakeViewModel(
        application = application,
        repository = GmailOwnerRepository(executor()),
        onSessionInvalidated = { sessionInvalidated += 1 }
    )

    private fun executor() = OwnerApiExecutor(
        apiConfig = ApiConfig(server.url("/").toString().trimEnd('/')),
        httpClient = OwnerHttpClientFactory.create(enableSafeLogging = false),
        tokenProvider =
        object : AccessTokenProvider {
            override suspend fun currentAccessToken(): String? = "access-token"
            override suspend fun refreshAccessToken(): String? = null
        },
        connectivity = FixedConnectivityMonitor(validated = true)
    )

    private fun enqueueIntake(vararg items: String) {
        val joined = items.joinToString(",")
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"items":[$joined],"nextCursor":null}""")
        )
    }

    private fun enqueueReview(body: String) {
        server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    }

    private fun enqueueError(status: Int, code: String) {
        server.enqueue(
            MockResponse()
                .setResponseCode(status)
                .setBody("""{"error":{"code":"$code","message":"nope","requestId":"req-1"}}""")
        )
    }

    private fun itemJson(id: String, subject: String): String = """
        {
          "id": "$id",
          "fromAddress": "sender@example.com",
          "subject": "$subject",
          "snippet": "Can you look at this",
          "receivedAt": "2026-08-13T18:00:00.000Z"
        }
    """.trimIndent()

    private val emptyReviewBody =
        """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": []
        }
        """.trimIndent()

    private fun proposalReviewBody(id: String, value: String): String = """
        {
          "idempotentReplay": false,
          "interpretedAt": "2026-08-13T18:00:00.000Z",
          "taskSuggestions": [
            {
              "id": "$id",
              "status": "pending",
              "version": 1,
              "etag": "etag-$id",
              "createdAt": "2026-08-13T18:00:00.000Z",
              "summaryPoints": [
                {
                  "id": "sp-$id",
                  "kind": "request",
                  "label": "Request",
                  "order": 0,
                  "value": "$value"
                }
              ]
            }
          ]
        }
    """.trimIndent()
}
