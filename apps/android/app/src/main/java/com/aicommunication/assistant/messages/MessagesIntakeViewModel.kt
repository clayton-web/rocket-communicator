package com.aicommunication.assistant.messages

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Device-local Messages intake only (D181 first slice).
 *
 * Must not receive [com.aicommunication.assistant.network.OwnerApiExecutor],
 * Gmail/manual-capture/proposal repositories, or any Review path. Notification
 * arrival never uploads, interprets, or creates Tasks.
 */
class MessagesIntakeViewModel(
    application: Application,
    private val store: MessagesLocalReviewStore,
    private val access: MessagesNotificationAccess,
    private val shapeProbe: MessagesNotificationShapeProbe
) : AndroidViewModel(application) {
    private var observingStore = false
    private var selectedId: String? = null
    private val _uiState =
        MutableStateFlow<MessagesIntakeUiState>(MessagesIntakeUiState.CheckingAccess)
    val uiState: StateFlow<MessagesIntakeUiState> = _uiState.asStateFlow()

    init {
        publish()
    }

    fun refreshAccess() {
        publish()
        observeStore()
    }

    fun select(id: String) {
        selectedId = id
        publish()
    }

    fun accessSettingsIntent(): Intent = access.settingsIntent()

    private fun observeStore() {
        if (observingStore) return
        observingStore = true
        viewModelScope.launch {
            store.snapshot.collect { publish() }
        }
    }

    private fun publish() {
        if (!access.isEnabled()) {
            _uiState.value = MessagesIntakeUiState.AccessDisabled
            return
        }
        val snap = store.snapshot.value
        _uiState.value =
            MessagesIntakeUiState.Ready(
                eligible = snap.eligible,
                filtered = snap.filtered,
                listenerError = snap.listenerError != null,
                shapes = shapeProbe.recent(),
                selectedId = selectedId?.takeIf { id -> snap.eligible.any { it.id == id } }
            )
    }

    class Factory(
        private val application: Application,
        private val store: MessagesLocalReviewStore,
        private val access: MessagesNotificationAccess,
        private val shapeProbe: MessagesNotificationShapeProbe
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(MessagesIntakeViewModel::class.java)) {
                return MessagesIntakeViewModel(
                    application,
                    store,
                    access,
                    shapeProbe
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
