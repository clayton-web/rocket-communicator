package com.aicommunication.assistant.messages

/**
 * Deterministic OTP / financial-alert exclusion (constitution + D181).
 *
 * Fail closed on known patterns. This is not a model prompt and does not attempt clever
 * reconstruction. Novel phrasings remain a documented device-evidence gap.
 */
object MessagesSensitiveContent {
    private val otpKeyword =
        Regex(
            """(?i)\b(?:otp|one[-\s]?time\s+(?:code|password|passcode|pin)|""" +
                """verification\s+code|security\s+code|authentication\s+code|""" +
                """auth\s+code|2fa|two[-\s]?factor|login\s+code|""" +
                """confirmation\s+code|confirm\s+code)\b"""
        )
    private val yourCodeIs = Regex("""(?i)\byour\s+code\s+is\b""")
    private val codeWithDigits =
        Regex("""(?i)\b(?:code|pin|passcode)\b[^A-Za-z0-9]{0,8}\b\d{4,8}\b""")
    private val financialKeyword =
        Regex(
            """(?i)\b(?:fraud\s+alert|unusual\s+activity|card\s+ending|""" +
                """account\s+ending|transaction\s+(?:alert|of|for)|""" +
                """purchase\s+of\s+\$|overdraft|direct\s+deposit|""" +
                """declined\s+transaction|amount\s+charged)\b"""
        )
    private val moneyAlert =
        Regex(
            """(?i)\$\d[\d,]*(?:\.\d{2})?\s+(?:was\s+)?""" +
                """(?:charged|spent|withdrawn|deposited|declined)"""
        )

    fun isOtpOrFinancial(vararg parts: String?): Boolean {
        val haystack = parts.filterNot { it.isNullOrBlank() }.joinToString(" ")
        if (haystack.isBlank()) return false
        return otpKeyword.containsMatchIn(haystack) ||
            yourCodeIs.containsMatchIn(haystack) ||
            codeWithDigits.containsMatchIn(haystack) ||
            financialKeyword.containsMatchIn(haystack) ||
            moneyAlert.containsMatchIn(haystack)
    }
}
