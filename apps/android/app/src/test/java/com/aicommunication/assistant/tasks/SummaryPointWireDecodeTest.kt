package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.ownerApiMoshi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Proves Moshi can decode OpenAPI-legitimate TaskSummaryPoint variants that omit `value`
 * (amount / deadline / missing_information), including the Production failure shape.
 */
class SummaryPointWireDecodeTest {
    private val pageAdapter = ownerApiMoshi().adapter(TaskListPageWire::class.java)
    private val taskAdapter = ownerApiMoshi().adapter(TaskWire::class.java)

    @Test
    fun decodesAmountWithoutValue() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t-amount",
                  "etag": "e1",
                  "status": "open",
                  "summaryPoints": [
                    {
                      "id": "p1",
                      "kind": "amount",
                      "label": "Invoice total",
                      "order": 0,
                      "amount": 4102,
                      "currency": "USD"
                    }
                  ]
                }
                """.trimIndent()
            )
        requireNotNull(task)
        val point = task.summaryPoints!!.single()
        assertEquals("amount", point.kind)
        assertNull(point.value)
        assertEquals(4102.0, point.amount)
        assertEquals("USD", point.currency)
        assertEquals("Invoice total", task.toOwnerTask().displayTitle)
    }

    @Test
    fun decodesDeadlineWithoutValue() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t-deadline",
                  "etag": "e1",
                  "status": "open",
                  "summaryPoints": [
                    {
                      "id": "p1",
                      "kind": "deadline",
                      "label": "Inspection deadline",
                      "order": 0,
                      "localDate": "2026-08-01",
                      "timezone": "America/Los_Angeles"
                    }
                  ]
                }
                """.trimIndent()
            )
        requireNotNull(task)
        val point = task.summaryPoints!!.single()
        assertEquals("deadline", point.kind)
        assertNull(point.value)
        assertEquals("2026-08-01", point.localDate)
        assertEquals("America/Los_Angeles", point.timezone)
        assertNull(point.dueAt)
        assertEquals("Inspection deadline", task.toOwnerTask().displayTitle)
    }

    @Test
    fun decodesMissingInformationWithoutValue() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t-missing",
                  "etag": "e1",
                  "status": "open",
                  "summaryPoints": [
                    {
                      "id": "p1",
                      "kind": "missing_information",
                      "label": "Missing address",
                      "order": 0,
                      "missingItem": "Property street address"
                    }
                  ]
                }
                """.trimIndent()
            )
        requireNotNull(task)
        val point = task.summaryPoints!!.single()
        assertEquals("missing_information", point.kind)
        assertNull(point.value)
        assertEquals("Property street address", point.missingItem)
        assertEquals("Missing address", task.toOwnerTask().displayTitle)
    }

    @Test
    fun decodesExplicitNullValue() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t-null-value",
                  "etag": "e1",
                  "status": "open",
                  "summaryPoints": [
                    {
                      "id": "p1",
                      "kind": "confirmed_fact",
                      "label": "Captured",
                      "order": 0,
                      "value": null
                    }
                  ]
                }
                """.trimIndent()
            )
        requireNotNull(task)
        assertNull(task.summaryPoints!!.single().value)
        assertEquals("Captured", task.toOwnerTask().displayTitle)
    }

    @Test
    fun decodesMixedValueBearingAndValueLessPoints() {
        val page =
            pageAdapter.fromJson(
                """
                {
                  "items": [
                    {
                      "id": "t0",
                      "etag": "e0",
                      "status": "open",
                      "summaryPoints": [
                        {
                          "id": "p0",
                          "kind": "confirmed_fact",
                          "label": "Captured",
                          "order": 0,
                          "value": "Buy paint"
                        }
                      ]
                    },
                    {
                      "id": "t1",
                      "etag": "e1",
                      "status": "open",
                      "summaryPoints": [
                        {
                          "id": "p1",
                          "kind": "request",
                          "label": "Request",
                          "order": 0,
                          "value": "Send documents"
                        }
                      ]
                    },
                    {
                      "id": "t2",
                      "etag": "e2",
                      "status": "open",
                      "summaryPoints": [
                        {
                          "id": "p2",
                          "kind": "next_action",
                          "label": "Next",
                          "order": 0,
                          "value": "Call Sarah"
                        }
                      ]
                    },
                    {
                      "id": "t3",
                      "etag": "e3",
                      "status": "open",
                      "summaryPoints": [
                        {
                          "id": "p0",
                          "kind": "request",
                          "label": "Request",
                          "order": 0,
                          "value": "Confirm venue"
                        },
                        {
                          "id": "p1",
                          "kind": "commitment",
                          "label": "Commitment",
                          "order": 1,
                          "value": "Reply by Friday"
                        },
                        {
                          "id": "p2",
                          "kind": "amount",
                          "label": "Deposit",
                          "order": 2,
                          "amount": 500,
                          "currency": "USD"
                        }
                      ]
                    }
                  ],
                  "nextCursor": null
                }
                """.trimIndent()
            )
        requireNotNull(page)
        assertEquals(4, page.items.size)

        val failingShape = page.items[3]
        assertEquals(3, failingShape.summaryPoints!!.size)
        assertEquals("Confirm venue", failingShape.summaryPoints!![0].value)
        assertEquals("Reply by Friday", failingShape.summaryPoints!![1].value)
        assertNull(failingShape.summaryPoints!![2].value)
        assertEquals("amount", failingShape.summaryPoints!![2].kind)
        assertEquals(500.0, failingShape.summaryPoints!![2].amount)
        assertEquals("USD", failingShape.summaryPoints!![2].currency)

        val mapped = failingShape.toOwnerTask()
        assertEquals("Confirm venue", mapped.displayTitle)
        assertTrue(mapped.isOwnerWork)
    }

    @Test
    fun stillDecodesValueBearingConfirmedFact() {
        val task =
            taskAdapter.fromJson(
                """
                {
                  "id": "t-value",
                  "etag": "e1",
                  "status": "open",
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
        requireNotNull(task)
        assertEquals("Order lumber", task.summaryPoints!!.single().value)
        assertEquals("Order lumber", task.toOwnerTask().displayTitle)
    }
}
