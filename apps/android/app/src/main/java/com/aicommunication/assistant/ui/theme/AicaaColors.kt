package com.aicommunication.assistant.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Android-local Rocket Communicator colours (D175 / S4.3).
 *
 * Hand-written against the authorized palette. Not generated from `packages/ui` (D116).
 * `#52525B` is deliberately absent: disabled state keeps Material's onSurface alpha
 * derivation, which is more legible than that token on these surfaces (D175).
 */
object AicaaColors {
    val background = Color(0xFF050506)
    val surface = Color(0xFF0B0B0D)
    val raised = Color(0xFF121216)
    val soft = Color(0xFF18181D)
    val coolSurface = Color(0xFF171A21)
    val structuralBorder = Color(0xFF2B2B33)
    val strongBorder = Color(0xFF454550)
    val informationalBorder = Color(0xFF343946)
    val ink = Color(0xFFF5F5F7)
    val muted = Color(0xFFA1A1AA)
    val outline = Color(0xFF7C7C87)
    val primary = Color(0xFFE10613)
    val onPrimary = Color(0xFFFFFFFF)
    val info = Color(0xFF8FA3BF)
    val focus = Color(0xFFD4D4D8)
    val success = Color(0xFF22C55E)
    val warning = Color(0xFFF59E0B)
    val destructive = Color(0xFFEF4444)
    val onError = Color(0xFF050506)
}
