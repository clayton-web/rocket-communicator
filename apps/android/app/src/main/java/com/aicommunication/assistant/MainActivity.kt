package com.aicommunication.assistant

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AicaaFoundationTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    FoundationPlaceholder()
                }
            }
        }
    }
}

@Composable
fun FoundationPlaceholder(modifier: Modifier = Modifier) {
    Column(
        modifier =
        modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F4))
            .padding(horizontal = 24.dp, vertical = 48.dp)
            .testTag("foundation_placeholder"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "AI Communication Action Assistant",
            fontSize = 28.sp,
            fontWeight = FontWeight.SemiBold,
            color = Color(0xFF1C1917),
            modifier = Modifier.semantics { heading() }
        )
        Text(
            text = "Android foundation is active.",
            fontSize = 16.sp,
            color = Color(0xFF57534E)
        )
        Text(
            text = "No communication capture is enabled.",
            fontSize = 15.sp,
            color = Color(0xFF0F766E)
        )
    }
}

@Composable
fun AicaaFoundationTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
        lightColorScheme(
            primary = Color(0xFF0F766E),
            background = Color(0xFFF5F5F4),
            surface = Color(0xFFF5F5F4),
            onBackground = Color(0xFF1C1917),
            onSurface = Color(0xFF1C1917)
        ),
        content = content
    )
}

@Preview(showBackground = true)
@Composable
private fun FoundationPlaceholderPreview() {
    AicaaFoundationTheme {
        FoundationPlaceholder()
    }
}
