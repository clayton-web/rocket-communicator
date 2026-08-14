package com.aicommunication.assistant.messages

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagesSensitiveContentTest {
    @Test
    fun otpPhrases_areExcluded() {
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("Your verification code is 123456"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("Your code is 847291"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("Use this OTP to sign in"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("one-time code 998877"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("2FA code 112233"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("security code: 445566"))
    }

    @Test
    fun financialAlerts_areExcluded() {
        assertTrue(
            MessagesSensitiveContent.isOtpOrFinancial("Fraud alert on your card ending 1234")
        )
        assertTrue(
            MessagesSensitiveContent.isOtpOrFinancial("Unusual activity on account ending 99")
        )
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("\$42.50 was charged at the store"))
        assertTrue(MessagesSensitiveContent.isOtpOrFinancial("Transaction alert for \$20.00"))
    }

    @Test
    fun ordinaryPlainText_isNotExcluded() {
        assertFalse(MessagesSensitiveContent.isOtpOrFinancial("Can you call me tomorrow"))
        assertFalse(
            MessagesSensitiveContent.isOtpOrFinancial("The gate code is written on the door")
        )
        assertFalse(MessagesSensitiveContent.isOtpOrFinancial(null, "", "   "))
    }
}
