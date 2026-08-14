package com.aicommunication.assistant.messages

/**
 * Explicit Google Messages package allowlist (D181).
 *
 * [GOOGLE_MESSAGES] is the published application id for Google Messages (Play / Google).
 * Samsung Messages and other vendor SMS apps are intentionally absent: D181 authorizes
 * Google Messages only, and extra packages must not be guessed for coverage.
 *
 * Galaxy S24+ still has to confirm that notifications from Google Messages arrive under
 * this package when it is the active messaging app. The allowlist is a closed set so a
 * later verified package can be added explicitly rather than inferred at runtime.
 */
object GoogleMessagesPackages {
    const val GOOGLE_MESSAGES = "com.google.android.apps.messaging"

    val ALLOWLIST: Set<String> = setOf(GOOGLE_MESSAGES)

    fun isAllowed(packageName: String): Boolean = packageName in ALLOWLIST
}
