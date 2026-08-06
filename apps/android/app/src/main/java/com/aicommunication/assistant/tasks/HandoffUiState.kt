package com.aicommunication.assistant.tasks

sealed class HandoffUiState {
    data object Loading : HandoffUiState()

    data class Ready(
        val task: OwnerTask,
        val recipients: List<RecipientWire>,
        val selectedRecipientId: String = "",
        val connection: GmailConnectionWire?,
        val confirming: Boolean = false,
        val submitting: Boolean = false,
        val pending: PendingHandoffOperation? = null,
        val banner: String? = null,
        val bannerTone: BannerTone = BannerTone.Info,
        val errorMessage: String? = null,
        val connectivityIssue: Boolean = false,
        val showRetryAfterReconsent: Boolean = false,
        val successDeliveryPath: String? = null,
        val createName: String = "",
        val createEmail: String = "",
        val creatingRecipient: Boolean = false
    ) : HandoffUiState() {
        val selectedRecipient: RecipientWire?
            get() = recipients.firstOrNull { it.id == selectedRecipientId }

        val canConfirm: Boolean
            get() =
                task.canAssign &&
                    selectedRecipient != null &&
                    connection?.canHandoffSend() == true &&
                    !submitting &&
                    successDeliveryPath == null

        val needsReconsent: Boolean
            get() = connection?.needsSendReconsent() == true

        val notConnected: Boolean
            get() = connection == null || connection.isConnected().not()
    }

    data class Error(
        val message: String,
        val connectivityIssue: Boolean = false
    ) : HandoffUiState()

    enum class BannerTone {
        Info,
        Success,
        Warning,
        Error
    }
}
