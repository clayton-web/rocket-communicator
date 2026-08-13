package com.aicommunication.assistant.tasks

sealed class TaskDetailUiState {
    data object Loading : TaskDetailUiState()

    data class Ready(
        val task: OwnerTask,
        val reminderEtag: String? = null,
        val reminderScheduleState: String? = null,
        val advanceEnabled: Boolean? = null,
        val advanceDisposition: String? = null,
        val advanceOccurrenceLocalDate: String? = null,
        val noteDraft: String = "",
        val mutating: Boolean = false,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false,
        val banner: String? = null
    ) : TaskDetailUiState() {
        val hasDeadline: Boolean
            get() = !task.dueLocalDate.isNullOrBlank()

        val canEditDueDate: Boolean
            get() = reminderEtag != null && !task.isTerminal && !mutating

        val canEditAdvanceReminder: Boolean
            get() = canEditDueDate && hasDeadline

        val automaticReminderOn: Boolean
            get() = hasDeadline && advanceEnabled == true

        /**
         * Show the D105 occurrence as an automatic schedule fact only when the preference is ON
         * and the recorded disposition is still the pending `scheduled` occurrence (or the
         * payload omitted disposition, in which case the day-before date is derived from the
         * canonical deadline).
         */
        val showsAutomaticAdvanceOccurrence: Boolean
            get() =
                automaticReminderOn &&
                    (advanceDisposition == null || advanceDisposition == "scheduled")

        val automaticAdvanceLocalDate: String?
            get() {
                if (!showsAutomaticAdvanceOccurrence) return null
                return advanceOccurrenceLocalDate
                    ?: task.dueLocalDate?.let(DueLocalDates::dayBefore)
            }
    }

    data class Error(
        val message: String,
        val connectivityIssue: Boolean = false
    ) : TaskDetailUiState()
}
