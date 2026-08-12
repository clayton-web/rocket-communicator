package com.aicommunication.assistant.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val AicaaLightColorScheme =
    lightColorScheme(
        primary = AicaaColors.accent,
        background = AicaaColors.paper,
        surface = AicaaColors.paper,
        onBackground = AicaaColors.ink,
        onSurface = AicaaColors.ink
    )

@Composable
fun AicaaFoundationTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AicaaLightColorScheme,
        content = content
    )
}
