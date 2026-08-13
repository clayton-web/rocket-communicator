package com.aicommunication.assistant.capture

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Presentation-only proposal rendering (S3.3b, D171). Android displays canonical summary points; it
 * infers no Recipient, responsibility, or deadline of its own.
 */
class ProposalPresentationTest {
    @Test
    fun summaryPointsRenderInCanonicalOrderRegardlessOfArrayPosition() {
        val proposal =
            proposal(
                point("sp3", "deadline", "Due", order = 2, value = "Friday"),
                point("sp1", "confirmed_fact", "Captured", order = 0, value = "Call the roofer"),
                point("sp2", "next_action", "Next", order = 1, value = "Get a quote")
            )

        assertEquals(
            listOf("sp1", "sp2", "sp3"),
            orderedSummaryPoints(proposal).map { it.id }
        )
    }

    @Test
    fun titleComesFromTheFirstCanonicalPointNotTheFirstArrayEntry() {
        val proposal =
            proposal(
                point("sp2", "deadline", "Due", order = 1, value = "Friday"),
                point("sp1", "confirmed_fact", "Captured", order = 0, value = "Call the roofer")
            )

        assertEquals("Call the roofer", deriveProposalTitle(proposal))
    }

    @Test
    fun titleFallsBackToTheShortIdWhenNoPointCarriesText() {
        val proposal = proposal()

        assertEquals("Task 11111111", deriveProposalTitle(proposal))
    }

    @Test
    fun detailUsesTheLabelWhenAPointCarriesNoValue() {
        val valueless = point("sp1", "amount", "Amount", order = 0, value = null)
        val blank = point("sp2", "confirmed_fact", "Captured", order = 1, value = "   ")
        val text = point("sp3", "next_action", "Next", order = 2, value = " Get a quote ")

        assertEquals("Amount", summaryPointDetail(valueless))
        assertEquals("Captured", summaryPointDetail(blank))
        assertEquals("Get a quote", summaryPointDetail(text))
    }

    @Test
    fun onlyPointsThatAlreadyCarryValueAreEditableWording() {
        val wording = point("sp1", "next_action", "Next", order = 0, value = "Get a quote")
        val amount =
            CaptureSummaryPointWire(
                id = "sp2",
                kind = "amount",
                label = "Amount",
                order = 1,
                amount = 500.0,
                currency = "USD"
            )
        val missing =
            CaptureSummaryPointWire(
                id = "sp3",
                kind = "missing_information",
                label = "Missing",
                order = 2,
                missingItem = "Street address"
            )
        val inference =
            CaptureSummaryPointWire(
                id = "sp4",
                kind = "inference",
                label = "Likely",
                order = 3,
                value = "Owner sounded urgent",
                confidence = 0.7
            )

        assertEquals(true, wording.hasEditableWording)
        assertEquals(false, amount.hasEditableWording)
        assertEquals(false, missing.hasEditableWording)
        assertEquals(true, inference.hasEditableWording)
        assertEquals("Amount", summaryPointDetail(amount))
        assertEquals("Missing", summaryPointDetail(missing))
    }

    private fun proposal(vararg points: CaptureSummaryPointWire) = TaskSuggestionWire(
        id = "11111111-1111-1111-1111-111111111111",
        status = "pending",
        summaryPoints = points.toList(),
        version = 1,
        etag = "etag-1",
        createdAt = "2026-08-12T15:00:00.000Z"
    )

    private fun point(id: String, kind: String, label: String, order: Int, value: String?) =
        CaptureSummaryPointWire(id = id, kind = kind, label = label, order = order, value = value)
}
