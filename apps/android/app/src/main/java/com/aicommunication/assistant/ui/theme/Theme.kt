package com.aicommunication.assistant.ui.theme

import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider

/**
 * Complete Material 3 dark scheme (D175). Every role is assigned explicitly so no
 * baseline light or violet default can reach rendered UI.
 */
internal val AicaaDarkColorScheme =
    darkColorScheme(
        primary = AicaaColors.primary,
        onPrimary = AicaaColors.onPrimary,
        primaryContainer = AicaaColors.raised,
        onPrimaryContainer = AicaaColors.ink,
        inversePrimary = AicaaColors.primary,
        secondary = AicaaColors.info,
        onSecondary = AicaaColors.background,
        secondaryContainer = AicaaColors.coolSurface,
        onSecondaryContainer = AicaaColors.ink,
        tertiary = AicaaColors.muted,
        onTertiary = AicaaColors.background,
        tertiaryContainer = AicaaColors.soft,
        onTertiaryContainer = AicaaColors.ink,
        background = AicaaColors.background,
        onBackground = AicaaColors.ink,
        surface = AicaaColors.surface,
        onSurface = AicaaColors.ink,
        surfaceVariant = AicaaColors.soft,
        onSurfaceVariant = AicaaColors.muted,
        surfaceTint = AicaaColors.surface,
        inverseSurface = AicaaColors.ink,
        inverseOnSurface = AicaaColors.background,
        error = AicaaColors.destructive,
        onError = AicaaColors.onError,
        errorContainer = AicaaColors.soft,
        onErrorContainer = AicaaColors.destructive,
        outline = AicaaColors.outline,
        outlineVariant = AicaaColors.structuralBorder,
        scrim = AicaaColors.background,
        surfaceBright = AicaaColors.soft,
        surfaceDim = AicaaColors.background,
        surfaceContainer = AicaaColors.raised,
        surfaceContainerHigh = AicaaColors.raised,
        surfaceContainerHighest = AicaaColors.soft,
        surfaceContainerLow = AicaaColors.surface,
        surfaceContainerLowest = AicaaColors.background
    )

@Composable
fun AicaaFoundationTheme(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTextSelectionColors provides AicaaTextSelectionColors) {
        MaterialTheme(
            colorScheme = AicaaDarkColorScheme,
            content = content
        )
    }
}
