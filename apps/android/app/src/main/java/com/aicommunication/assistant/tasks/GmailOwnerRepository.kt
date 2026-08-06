package com.aicommunication.assistant.tasks

import com.aicommunication.assistant.network.OwnerApiExecutor
import com.aicommunication.assistant.network.OwnerApiRepository
import com.aicommunication.assistant.network.OwnerApiResult

/** Gmail connection status for truthful handoff gating (A9.3 / D093). */
class GmailOwnerRepository(
    executor: OwnerApiExecutor
) : OwnerApiRepository(executor) {
    suspend fun getConnection(): OwnerApiResult<GmailConnectionWire> =
        get("/api/v1/gmail/connection", GmailConnectionWire::class.java)
}

fun GmailConnectionWire.isConnected(): Boolean = status.equals("connected", ignoreCase = true)

fun GmailConnectionWire.needsSendReconsent(): Boolean {
    if (!isConnected()) return false
    if (requiresSendReconsent == true) return true
    if (canSend == false) return true
    return false
}

fun GmailConnectionWire.canHandoffSend(): Boolean = isConnected() && !needsSendReconsent()
