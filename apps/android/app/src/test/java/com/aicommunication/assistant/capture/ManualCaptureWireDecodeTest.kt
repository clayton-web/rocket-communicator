package com.aicommunication.assistant.capture

import com.aicommunication.assistant.network.ownerApiMoshi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decoding of `ManualCaptureResponse` (S3.2 contract) through hand-written wire DTOs: 0..N
 * proposals, every awkward summary-point variant, and replay signalling.
 */
class ManualCaptureWireDecodeTest {
    private val adapter = ownerApiMoshi().adapter(ManualCaptureResponseWire::class.java)

    private fun response(suggestions: String, replay: Boolean = false) = """
        {
          "idempotentReplay": $replay,
          "interpretedAt": "2026-08-12T15:04:05.123Z",
          "taskSuggestions": [$suggestions]
        }
    """.trimIndent()

    private fun suggestion(
        id: String,
        points: String,
        version: Int = 1,
        approvedTaskIdJson: String? = null
    ): String {
        val approved =
            if (approvedTaskIdJson == null) {
                ""
            } else {
                ",\n          \"approvedTaskId\": $approvedTaskIdJson"
            }
        return """
        {
          "id": "$id",
          "organizationId": "org-1",
          "status": "pending",
          "summaryPoints": [$points],
          "version": $version,
          "etag": "\"task-suggestion-$id-v$version\"",
          "createdAt": "2026-08-12T15:04:05.123Z",
          "updatedAt": "2026-08-12T15:04:05.123Z"$approved
        }
        """.trimIndent()
    }

    @Test
    fun zeroProposalsIsSuccessfullyParsedAsAnEmptyList() {
        val parsed = requireNotNull(adapter.fromJson(response(suggestions = "")))

        assertTrue(parsed.taskSuggestions.isEmpty())
        assertFalse(parsed.idempotentReplay)
        assertEquals("2026-08-12T15:04:05.123Z", parsed.interpretedAt)
    }

    @Test
    fun oneProposalParses() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            id = "sug-1",
                            points =
                            """
                            {"id":"p1","kind":"next_action","label":"Next","order":0,
                             "value":"Call the roofer"}
                            """.trimIndent()
                        )
                    )
                )
            )

        val proposal = parsed.taskSuggestions.single()
        assertEquals("sug-1", proposal.id)
        assertEquals("pending", proposal.status)
        assertEquals(1, proposal.version)
        assertEquals("\"task-suggestion-sug-1-v1\"", proposal.etag)
        assertEquals("2026-08-12T15:04:05.123Z", proposal.createdAt)
        assertEquals("Call the roofer", proposal.summaryPoints.single().value)
        assertNull(proposal.approvedTaskId)
    }

    @Test
    fun multipleProposalsParseInOrder() {
        val point = { text: String ->
            """{"id":"p1","kind":"request","label":"Request","order":0,"value":"$text"}"""
        }
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        listOf(
                            suggestion("sug-1", point("Confirm venue")),
                            suggestion("sug-2", point("Send deposit"), version = 2),
                            suggestion("sug-3", point("Book inspection"))
                        ).joinToString(",")
                    )
                )
            )

        assertEquals(3, parsed.taskSuggestions.size)
        assertEquals(listOf("sug-1", "sug-2", "sug-3"), parsed.taskSuggestions.map { it.id })
        assertEquals(2, parsed.taskSuggestions[1].version)
        assertEquals("Book inspection", parsed.taskSuggestions[2].summaryPoints.single().value)
    }

    @Test
    fun summaryPointVariantsWithoutValueStillDecode() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            id = "sug-mixed",
                            points =
                            """
                            {"id":"p0","kind":"confirmed_fact","label":"Captured","order":0,
                             "value":"Roof leak reported"},
                            {"id":"p1","kind":"amount","label":"Deposit","order":1,
                             "amount":500,"currency":"USD"},
                            {"id":"p2","kind":"deadline","label":"Inspection deadline","order":2,
                             "localDate":"2026-08-20","timezone":"America/Los_Angeles"},
                            {"id":"p3","kind":"missing_information","label":"Missing address",
                             "order":3,"missingItem":"Property street address"},
                            {"id":"p4","kind":"inference","label":"Likely urgent","order":4,
                             "value":"Owner sounded urgent","confidence":0.7}
                            """.trimIndent()
                        )
                    )
                )
            )

        val points = parsed.taskSuggestions.single().summaryPoints
        assertEquals(5, points.size)
        assertEquals("Roof leak reported", points[0].value)
        assertEquals("amount", points[1].kind)
        assertNull(points[1].value)
        assertEquals("deadline", points[2].kind)
        assertNull(points[2].value)
        assertEquals("missing_information", points[3].kind)
        assertNull(points[3].value)
        assertEquals("Owner sounded urgent", points[4].value)
    }

    @Test
    fun idempotentReplayParses() {
        val replayed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            "sug-1",
                            """{"id":"p1","kind":"request","label":"Request","order":0,
                               "value":"Confirm venue"}
                            """.trimIndent()
                        ),
                        replay = true
                    )
                )
            )

        assertTrue(replayed.idempotentReplay)
        // A replay decodes through exactly the same shape as a first success.
        assertEquals("sug-1", replayed.taskSuggestions.single().id)
    }

    @Test
    fun unmodelledProposalFieldsAreIgnored() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    """
                    {
                      "idempotentReplay": false,
                      "interpretedAt": "2026-08-12T15:04:05.123Z",
                      "taskSuggestions": [
                        {
                          "id": "sug-1",
                          "organizationId": "org-1",
                          "status": "pending",
                          "summaryPoints": [
                            {"id":"p1","kind":"request","label":"Request","order":0,
                             "value":"Confirm venue","sensitivity":"normal"}
                          ],
                          "sourceReference": {"kind":"manual"},
                          "proposedRecipientId": null,
                          "proposedDueAt": null,
                          "voiceOriginated": false,
                          "retention": {"purgeAt": "2026-08-19T15:04:05.123Z"},
                          "version": 1,
                          "etag": "\"task-suggestion-sug-1-v1\"",
                          "createdAt": "2026-08-12T15:04:05.123Z",
                          "updatedAt": "2026-08-12T15:04:05.123Z"
                        }
                      ]
                    }
                    """.trimIndent()
                )
            )

        assertEquals("sug-1", parsed.taskSuggestions.single().id)
        assertNull(parsed.taskSuggestions.single().approvedTaskId)
    }

    @Test
    fun approvedTaskIdDecodesWhenPresent() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            id = "sug-1",
                            points =
                            """{"id":"p1","kind":"request","label":"Request","order":0,
                               "value":"Confirm venue"}
                            """.trimIndent(),
                            approvedTaskIdJson = "\"task-1\""
                        )
                    )
                )
            )

        assertEquals("task-1", parsed.taskSuggestions.single().approvedTaskId)
    }

    @Test
    fun approvedTaskIdNullDecodesAsNull() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            id = "sug-1",
                            points =
                            """{"id":"p1","kind":"request","label":"Request","order":0,
                               "value":"Confirm venue"}
                            """.trimIndent(),
                            approvedTaskIdJson = "null"
                        )
                    )
                )
            )

        assertNull(parsed.taskSuggestions.single().approvedTaskId)
    }

    @Test
    fun summaryPointsDecodeIntoTheSharedHandWrittenWireType() {
        val parsed =
            requireNotNull(
                adapter.fromJson(
                    response(
                        suggestion(
                            "sug-1",
                            """{"id":"p1","kind":"request","label":"Request","order":0,
                               "value":"Confirm venue"}
                            """.trimIndent()
                        )
                    )
                )
            )

        // No generated polymorphic TaskSummaryPoint participates in runtime decoding.
        assertEquals(
            CaptureSummaryPointWire::class.java,
            parsed.taskSuggestions.single().summaryPoints.single().javaClass
        )
    }

    @Test
    fun aResponseMissingRequiredFieldsFailsToDecode() {
        val failure =
            runCatching {
                adapter.fromJson(
                    """{"interpretedAt":"2026-08-12T15:04:05.123Z","taskSuggestions":[]}"""
                )
            }

        assertTrue(failure.isFailure)
    }
}
