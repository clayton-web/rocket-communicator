package com.aicommunication.assistant.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * Online-first connectivity awareness for Owner API calls (A9.1 / D132).
 *
 * Absence of a validated network is surfaced truthfully; this is not offline sync.
 */
interface ConnectivityMonitor {
    fun isNetworkValidated(): Boolean
}

class AndroidConnectivityMonitor(
    context: Context
) : ConnectivityMonitor {
    private val connectivityManager =
        context.applicationContext.getSystemService(
            Context.CONNECTIVITY_SERVICE
        ) as ConnectivityManager

    override fun isNetworkValidated(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }
}

/** Test double: always reports connectivity unless overridden. */
class FixedConnectivityMonitor(
    private val validated: Boolean
) : ConnectivityMonitor {
    override fun isNetworkValidated(): Boolean = validated
}
