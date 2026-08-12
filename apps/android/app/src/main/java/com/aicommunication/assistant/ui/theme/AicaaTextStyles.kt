package com.aicommunication.assistant.ui.theme

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Repeated Android text styles already used by Owner screens. */
object AicaaTextStyles {
    val pageHeading =
        TextStyle(
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold
        )
    val sectionTitle =
        TextStyle(
            fontSize = 20.sp,
            fontWeight = FontWeight.Medium
        )
    val body =
        TextStyle(
            fontSize = 16.sp
        )
}
