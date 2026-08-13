package com.aicommunication.assistant.tasks

import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DueLocalDatesTest {
    @Test
    fun acceptsRealCalendarDatesOnly() {
        assertTrue(DueLocalDates.isValid("2026-08-20"))
        assertFalse(DueLocalDates.isValid("2026-08-20T09:00:00"))
        assertFalse(DueLocalDates.isValid("2026/08/20"))
        assertFalse(DueLocalDates.isValid("2026-8-20"))
        assertFalse(DueLocalDates.isValid("2026-02-30"))
        assertFalse(DueLocalDates.isValid(""))
    }

    @Test
    fun utcMillisRoundTripPreservesTheCivilDate() {
        val millis = DueLocalDates.toUtcEpochMillis("2026-08-20")
        requireNotNull(millis)
        assertEquals("2026-08-20", DueLocalDates.fromUtcEpochMillis(millis))
        val utcDate = LocalDate.ofInstant(java.time.Instant.ofEpochMilli(millis), ZoneOffset.UTC)
        assertEquals(LocalDate.of(2026, 8, 20), utcDate)
    }

    @Test
    fun formatForDisplayIsDateOnly() {
        assertEquals("Aug 20, 2026", DueLocalDates.formatForDisplay("2026-08-20"))
        assertEquals("Thursday, August 20", DueLocalDates.formatWeekday("2026-08-20"))
        assertEquals("2026-08-19", DueLocalDates.dayBefore("2026-08-20"))
        assertNull(DueLocalDates.dayBefore("not-a-date"))
        assertNull(DueLocalDates.toUtcEpochMillis("not-a-date"))
    }
}
