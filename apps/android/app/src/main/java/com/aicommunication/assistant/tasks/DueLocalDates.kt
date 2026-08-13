package com.aicommunication.assistant.tasks

import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Date-only due-date helpers (S6.2 / D177).
 *
 * A due date is an organization-local calendar date (`YYYY-MM-DD`), never a due time.
 * Material DatePicker millis are UTC midnight of the selected civil date — convert through
 * UTC so the picked calendar day is not shifted by the device zone.
 */
object DueLocalDates {
    private val pattern = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val displayFormatter =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.US)
    private val weekdayFormatter =
        DateTimeFormatter.ofPattern("EEEE, MMMM d").withLocale(Locale.US)

    fun isValid(value: String): Boolean {
        if (!pattern.matches(value)) return false
        return try {
            LocalDate.parse(value)
            true
        } catch (_: DateTimeParseException) {
            false
        }
    }

    fun fromUtcEpochMillis(millis: Long): String? = try {
        Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC).toLocalDate().toString()
    } catch (_: DateTimeException) {
        null
    }

    fun toUtcEpochMillis(dueLocalDate: String): Long? {
        if (!isValid(dueLocalDate)) return null
        return try {
            LocalDate.parse(dueLocalDate).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        } catch (_: DateTimeException) {
            null
        }
    }

    fun formatForDisplay(dueLocalDate: String): String {
        if (!isValid(dueLocalDate)) return dueLocalDate
        return try {
            LocalDate.parse(dueLocalDate).format(displayFormatter)
        } catch (_: DateTimeException) {
            dueLocalDate
        }
    }

    fun formatWeekday(dueLocalDate: String): String {
        if (!isValid(dueLocalDate)) return dueLocalDate
        return try {
            LocalDate.parse(dueLocalDate).format(weekdayFormatter)
        } catch (_: DateTimeException) {
            dueLocalDate
        }
    }

    /** Calendar day before [dueLocalDate]. Null when the due date is not a real calendar date. */
    fun dayBefore(dueLocalDate: String): String? {
        if (!isValid(dueLocalDate)) return null
        return try {
            LocalDate.parse(dueLocalDate).minusDays(1).toString()
        } catch (_: DateTimeException) {
            null
        }
    }
}
