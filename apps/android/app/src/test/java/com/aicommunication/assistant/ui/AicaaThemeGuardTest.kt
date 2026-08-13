package com.aicommunication.assistant.ui

import androidx.compose.ui.graphics.Color
import com.aicommunication.assistant.ui.theme.AicaaColors
import com.aicommunication.assistant.ui.theme.AicaaDarkColorScheme
import com.aicommunication.assistant.ui.theme.AicaaMinButtonHeight
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * D175 / S4.3 Android presentation guards. These pins must be updated in the same reviewed
 * slice as any later value change — never deleted, loosened, skipped, or bypassed.
 */
class AicaaThemeGuardTest {
    @Test
    fun pinsAuthorizedAndroidTokenValues() {
        assertEquals(Color(0xFF050506), AicaaColors.background)
        assertEquals(Color(0xFF0B0B0D), AicaaColors.surface)
        assertEquals(Color(0xFF121216), AicaaColors.raised)
        assertEquals(Color(0xFF18181D), AicaaColors.soft)
        assertEquals(Color(0xFF171A21), AicaaColors.coolSurface)
        assertEquals(Color(0xFF2B2B33), AicaaColors.structuralBorder)
        assertEquals(Color(0xFF454550), AicaaColors.strongBorder)
        assertEquals(Color(0xFF343946), AicaaColors.informationalBorder)
        assertEquals(Color(0xFFF5F5F7), AicaaColors.ink)
        assertEquals(Color(0xFFA1A1AA), AicaaColors.muted)
        assertEquals(Color(0xFF7C7C87), AicaaColors.outline)
        assertEquals(Color(0xFFE10613), AicaaColors.primary)
        assertEquals(Color(0xFFFFFFFF), AicaaColors.onPrimary)
        assertEquals(Color(0xFF8FA3BF), AicaaColors.info)
        assertEquals(Color(0xFFD4D4D8), AicaaColors.focus)
        assertEquals(Color(0xFF22C55E), AicaaColors.success)
        assertEquals(Color(0xFFF59E0B), AicaaColors.warning)
        assertEquals(Color(0xFFEF4444), AicaaColors.destructive)
        assertEquals(Color(0xFF050506), AicaaColors.onError)
        assertEquals(44, AicaaMinButtonHeight.value.toInt())
    }

    @Test
    fun pinsExplicitThirtySixRoleMaterialMapping() {
        val roles =
            mapOf(
                "primary" to AicaaDarkColorScheme.primary,
                "onPrimary" to AicaaDarkColorScheme.onPrimary,
                "primaryContainer" to AicaaDarkColorScheme.primaryContainer,
                "onPrimaryContainer" to AicaaDarkColorScheme.onPrimaryContainer,
                "inversePrimary" to AicaaDarkColorScheme.inversePrimary,
                "secondary" to AicaaDarkColorScheme.secondary,
                "onSecondary" to AicaaDarkColorScheme.onSecondary,
                "secondaryContainer" to AicaaDarkColorScheme.secondaryContainer,
                "onSecondaryContainer" to AicaaDarkColorScheme.onSecondaryContainer,
                "tertiary" to AicaaDarkColorScheme.tertiary,
                "onTertiary" to AicaaDarkColorScheme.onTertiary,
                "tertiaryContainer" to AicaaDarkColorScheme.tertiaryContainer,
                "onTertiaryContainer" to AicaaDarkColorScheme.onTertiaryContainer,
                "background" to AicaaDarkColorScheme.background,
                "onBackground" to AicaaDarkColorScheme.onBackground,
                "surface" to AicaaDarkColorScheme.surface,
                "onSurface" to AicaaDarkColorScheme.onSurface,
                "surfaceVariant" to AicaaDarkColorScheme.surfaceVariant,
                "onSurfaceVariant" to AicaaDarkColorScheme.onSurfaceVariant,
                "surfaceTint" to AicaaDarkColorScheme.surfaceTint,
                "inverseSurface" to AicaaDarkColorScheme.inverseSurface,
                "inverseOnSurface" to AicaaDarkColorScheme.inverseOnSurface,
                "error" to AicaaDarkColorScheme.error,
                "onError" to AicaaDarkColorScheme.onError,
                "errorContainer" to AicaaDarkColorScheme.errorContainer,
                "onErrorContainer" to AicaaDarkColorScheme.onErrorContainer,
                "outline" to AicaaDarkColorScheme.outline,
                "outlineVariant" to AicaaDarkColorScheme.outlineVariant,
                "scrim" to AicaaDarkColorScheme.scrim,
                "surfaceBright" to AicaaDarkColorScheme.surfaceBright,
                "surfaceDim" to AicaaDarkColorScheme.surfaceDim,
                "surfaceContainer" to AicaaDarkColorScheme.surfaceContainer,
                "surfaceContainerHigh" to AicaaDarkColorScheme.surfaceContainerHigh,
                "surfaceContainerHighest" to AicaaDarkColorScheme.surfaceContainerHighest,
                "surfaceContainerLow" to AicaaDarkColorScheme.surfaceContainerLow,
                "surfaceContainerLowest" to AicaaDarkColorScheme.surfaceContainerLowest
            )

        assertEquals(36, roles.size)
        assertEquals(AicaaColors.primary, roles.getValue("primary"))
        assertEquals(AicaaColors.onPrimary, roles.getValue("onPrimary"))
        assertEquals(AicaaColors.raised, roles.getValue("primaryContainer"))
        assertEquals(AicaaColors.ink, roles.getValue("onPrimaryContainer"))
        assertEquals(AicaaColors.primary, roles.getValue("inversePrimary"))
        assertEquals(AicaaColors.info, roles.getValue("secondary"))
        assertEquals(AicaaColors.background, roles.getValue("onSecondary"))
        assertEquals(AicaaColors.coolSurface, roles.getValue("secondaryContainer"))
        assertEquals(AicaaColors.ink, roles.getValue("onSecondaryContainer"))
        assertEquals(AicaaColors.muted, roles.getValue("tertiary"))
        assertEquals(AicaaColors.background, roles.getValue("onTertiary"))
        assertEquals(AicaaColors.soft, roles.getValue("tertiaryContainer"))
        assertEquals(AicaaColors.ink, roles.getValue("onTertiaryContainer"))
        assertEquals(AicaaColors.background, roles.getValue("background"))
        assertEquals(AicaaColors.ink, roles.getValue("onBackground"))
        assertEquals(AicaaColors.surface, roles.getValue("surface"))
        assertEquals(AicaaColors.ink, roles.getValue("onSurface"))
        assertEquals(AicaaColors.soft, roles.getValue("surfaceVariant"))
        assertEquals(AicaaColors.muted, roles.getValue("onSurfaceVariant"))
        assertEquals(AicaaColors.surface, roles.getValue("surfaceTint"))
        assertEquals(AicaaColors.ink, roles.getValue("inverseSurface"))
        assertEquals(AicaaColors.background, roles.getValue("inverseOnSurface"))
        assertEquals(AicaaColors.destructive, roles.getValue("error"))
        assertEquals(AicaaColors.onError, roles.getValue("onError"))
        assertEquals(AicaaColors.soft, roles.getValue("errorContainer"))
        assertEquals(AicaaColors.destructive, roles.getValue("onErrorContainer"))
        assertEquals(AicaaColors.outline, roles.getValue("outline"))
        assertEquals(AicaaColors.structuralBorder, roles.getValue("outlineVariant"))
        assertEquals(AicaaColors.background, roles.getValue("scrim"))
        assertEquals(AicaaColors.soft, roles.getValue("surfaceBright"))
        assertEquals(AicaaColors.background, roles.getValue("surfaceDim"))
        assertEquals(AicaaColors.raised, roles.getValue("surfaceContainer"))
        assertEquals(AicaaColors.raised, roles.getValue("surfaceContainerHigh"))
        assertEquals(AicaaColors.soft, roles.getValue("surfaceContainerHighest"))
        assertEquals(AicaaColors.surface, roles.getValue("surfaceContainerLow"))
        assertEquals(AicaaColors.background, roles.getValue("surfaceContainerLowest"))

        val authorized =
            setOf(
                AicaaColors.background,
                AicaaColors.surface,
                AicaaColors.raised,
                AicaaColors.soft,
                AicaaColors.coolSurface,
                AicaaColors.structuralBorder,
                AicaaColors.ink,
                AicaaColors.muted,
                AicaaColors.outline,
                AicaaColors.primary,
                AicaaColors.onPrimary,
                AicaaColors.info,
                AicaaColors.destructive,
                AicaaColors.onError
            )
        roles.values.forEach { color ->
            assertTrue("scheme role $color is outside the authorized set", color in authorized)
        }
    }

    @Test
    fun themeSourceAssignsEveryMaterialRoleExplicitly() {
        val theme = read("src/main/java/com/aicommunication/assistant/ui/theme/Theme.kt")
        assertFalse(theme.contains("lightColorScheme"))
        MATERIAL_ROLE_NAMES.forEach { role ->
            assertTrue("Theme.kt must assign $role explicitly", theme.contains("$role ="))
        }
    }

    @Test
    fun presentationLayerOmitsLegacyAndBaselineColours() {
        presentationFiles().forEach { file ->
            val text = stripComments(file.readText())
            FORBIDDEN_HEX.forEach { hex ->
                assertFalse(
                    "${file.name} still contains forbidden $hex",
                    containsHex(text, hex)
                )
            }
        }
    }

    @Test
    fun disabledTokenIsAbsentBecauseMaterialAlphaIsRetained() {
        presentationFiles().forEach { file ->
            assertFalse(
                "${file.name} must not introduce #52525B; Material alpha is retained (D175)",
                containsHex(stripComments(file.readText()), "52525B")
            )
        }
    }

    @Test
    fun composeScreensDoNotContainColourLiterals() {
        screenFiles().forEach { file ->
            val text = file.readText()
            assertFalse(
                "${file.name} contains Color( where a theme role exists",
                COLOR_LITERAL.containsMatchIn(text)
            )
            assertFalse(
                "${file.name} contains a hex colour literal",
                HEX_LITERAL.containsMatchIn(text)
            )
        }
    }

    @Test
    fun doesNotIntroduceShapesMotionOrTypographyMigration() {
        presentationFiles().forEach { file ->
            val text = file.readText()
            SHAPE_APIS.forEach { token ->
                assertFalse("${file.name} introduces $token", text.contains(token))
            }
            MOTION_APIS.forEach { token ->
                assertFalse("${file.name} introduces $token", text.contains(token))
            }
            FONT_APIS.forEach { token ->
                assertFalse("${file.name} introduces $token", text.contains(token))
            }
        }
        assertFalse(File(androidAppRoot(), "src/main/res/font").exists())
        assertFalse(File(androidAppRoot(), "src/main/res/anim").exists())
        val theme = read("src/main/java/com/aicommunication/assistant/ui/theme/Theme.kt")
        assertFalse(theme.contains("shapes ="))
        assertFalse(theme.contains("typography ="))
    }

    @Test
    fun xmlWindowThemeIsDarkWithAuthorizedBackground() {
        val xml = read("src/main/res/values/themes.xml")
        assertTrue(xml.contains("parent=\"android:Theme.Material.NoActionBar\""))
        assertTrue(xml.contains("android:windowBackground\">#050506"))
        assertTrue(xml.contains("android:windowLightStatusBar\">false"))
        assertTrue(xml.contains("android:windowLightNavigationBar\">false"))
        assertFalse(xml.contains("Theme.Material.Light"))
    }

    private fun androidAppRoot(): File {
        var dir = File(System.getProperty("user.dir")!!)
        repeat(8) {
            val candidate = File(dir, "src/main/AndroidManifest.xml")
            if (candidate.exists()) return dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.exists()) return File(dir, "app")
            dir = dir.parentFile ?: return File(System.getProperty("user.dir")!!)
        }
        error("Could not locate apps/android/app from ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String = File(androidAppRoot(), relative).readText()

    private fun presentationFiles(): List<File> {
        val root = androidAppRoot()
        return listOf(
            File(root, "src/main/java/com/aicommunication/assistant/ui"),
            File(root, "src/main/java/com/aicommunication/assistant/MainActivity.kt"),
            File(root, "src/main/res/values/themes.xml")
        ).flatMap { path ->
            if (path.isDirectory) path.walkTopDown().filter { it.isFile }.toList() else listOf(path)
        }
    }

    private fun screenFiles(): List<File> =
        File(androidAppRoot(), "src/main/java/com/aicommunication/assistant/ui")
            .listFiles { file -> file.isFile && file.extension == "kt" }
            .orEmpty()
            .toList()

    private fun containsHex(text: String, hex: String): Boolean {
        return Regex("(?i)(#|0xFF?)$hex").containsMatchIn(text)
    }

    private fun stripComments(text: String): String = text
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .replace(Regex("""<!--[\s\S]*?-->"""), "")
        .replace(Regex("""//.*"""), "")

    companion object {
        private val COLOR_LITERAL = Regex("""Color\s*\(""")
        private val HEX_LITERAL = Regex("""(?:#|0xFF?)[0-9A-Fa-f]{6}""")

        private val MATERIAL_ROLE_NAMES =
            listOf(
                "primary",
                "onPrimary",
                "primaryContainer",
                "onPrimaryContainer",
                "inversePrimary",
                "secondary",
                "onSecondary",
                "secondaryContainer",
                "onSecondaryContainer",
                "tertiary",
                "onTertiary",
                "tertiaryContainer",
                "onTertiaryContainer",
                "background",
                "onBackground",
                "surface",
                "onSurface",
                "surfaceVariant",
                "onSurfaceVariant",
                "surfaceTint",
                "inverseSurface",
                "inverseOnSurface",
                "error",
                "onError",
                "errorContainer",
                "onErrorContainer",
                "outline",
                "outlineVariant",
                "scrim",
                "surfaceBright",
                "surfaceDim",
                "surfaceContainer",
                "surfaceContainerHigh",
                "surfaceContainerHighest",
                "surfaceContainerLow",
                "surfaceContainerLowest"
            )

        private val FORBIDDEN_HEX =
            listOf(
                "1C1917",
                "57534E",
                "F5F5F4",
                "0F766E",
                "B91C1C",
                "B45309",
                "44403C",
                "E7E5E4",
                "E6E0E9",
                "ECE6F0",
                "49454F",
                "625B71",
                "79747E",
                "CAC4D0",
                "B3261E",
                "F9DEDC",
                "410E0B",
                "D0BCFF",
                "141218",
                "F2B8B5",
                "6750A4",
                "EADDFF",
                "381E72",
                "4F378B"
            )

        private val SHAPE_APIS =
            listOf("RoundedCornerShape", "CutCornerShape", "AbsoluteRoundedCornerShape", "Shapes(")

        private val MOTION_APIS =
            listOf(
                "AnimatedVisibility",
                "Crossfade",
                "animateContentSize",
                "animateColorAsState",
                "animateFloatAsState",
                "animateDpAsState",
                "rememberInfiniteTransition",
                "updateTransition",
                "Animatable("
            )

        private val FONT_APIS = listOf("FontFamily", "Typography(", "res/font", "R.font")
    }
}
