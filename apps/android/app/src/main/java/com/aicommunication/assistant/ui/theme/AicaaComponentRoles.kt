package com.aicommunication.assistant.ui.theme

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** BRAND.md / D175 minimum interactive height for filled buttons and TextButtons. */
internal val AicaaMinButtonHeight = 44.dp

internal val AicaaTextSelectionColors =
    TextSelectionColors(
        handleColor = AicaaColors.focus,
        backgroundColor = AicaaColors.focus.copy(alpha = 0.4f)
    )

@Composable
internal fun aicaaTextButtonColors() =
    ButtonDefaults.textButtonColors(contentColor = AicaaColors.info)

@Composable
internal fun aicaaDestructiveTextButtonColors() =
    ButtonDefaults.textButtonColors(contentColor = AicaaColors.destructive)

@Composable
internal fun aicaaOutlinedTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = AicaaColors.focus,
    focusedLabelColor = AicaaColors.focus,
    cursorColor = AicaaColors.focus
)

@Composable
internal fun aicaaRadioButtonColors() = RadioButtonDefaults.colors(selectedColor = AicaaColors.info)

@Composable
fun AicaaFilledButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    Button(
        onClick = onClick,
        modifier = modifier.heightIn(min = AicaaMinButtonHeight),
        enabled = enabled,
        content = content
    )
}

@Composable
fun AicaaTextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    TextButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = AicaaMinButtonHeight),
        enabled = enabled,
        colors = aicaaTextButtonColors(),
        content = content
    )
}

@Composable
fun AicaaDestructiveTextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    TextButton(
        onClick = onClick,
        modifier = modifier.heightIn(min = AicaaMinButtonHeight),
        enabled = enabled,
        colors = aicaaDestructiveTextButtonColors(),
        content = content
    )
}

@Composable
fun AicaaOutlinedTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    placeholder: @Composable (() -> Unit)? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        enabled = enabled,
        placeholder = placeholder,
        keyboardOptions = keyboardOptions,
        colors = aicaaOutlinedTextFieldColors()
    )
}

@Composable
fun AicaaRadioButton(selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    RadioButton(
        selected = selected,
        onClick = onClick,
        modifier = modifier,
        colors = aicaaRadioButtonColors()
    )
}

@Composable
fun AicaaCircularProgressIndicator(modifier: Modifier = Modifier) {
    CircularProgressIndicator(modifier = modifier, color = AicaaColors.info)
}
