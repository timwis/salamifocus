package dev.salamifocus.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.ReportDrawnWhen
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.salamifocus.SalamifocusApp

/**
 * Opened from the home-screen shortcut: a field with the keyboard up, ready to
 * type. It works signed out too; captures wait on the phone until sign-in.
 */
class CaptureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as SalamifocusApp
        setContent {
            MaterialTheme {
                CaptureScreen(app, onOpenInbox = {
                    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CaptureScreen(app: SalamifocusApp, onOpenInbox: () -> Unit) {
    val state = rememberCaptureState(app)
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) {
        focus.requestFocus()
        keyboard?.show()
    }
    // Marks launch as complete for `am start` and logcat timings once typing can begin.
    val imeVisible = WindowInsets.isImeVisible
    ReportDrawnWhen { imeVisible }

    Column(modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Capture to Inbox", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onOpenInbox) { Text("Inbox") }
        }
        CaptureField(state, modifier = Modifier.padding(vertical = 12.dp), fieldModifier = Modifier.focusRequester(focus))
        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f).testTag("recent-captures")) {
            items(state.recent, key = { it.key }) { capture ->
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) {}) {
                    Text(capture.text)
                    CaptureOutcome(
                        app,
                        capture,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
        }
    }
}
