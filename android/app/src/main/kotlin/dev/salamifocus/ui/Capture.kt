package dev.salamifocus.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.salamifocus.SalamifocusApp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

sealed interface CaptureResult {
    data object Saving : CaptureResult
    data class Saved(val taskId: String) : CaptureResult
    data class Failed(val reason: String) : CaptureResult
}

class RecentCapture(val key: Int, val text: String) {
    var result by mutableStateOf<CaptureResult>(CaptureResult.Saving)
}

/**
 * Text being typed for the Inbox, and what became of each capture made from
 * this screen, newest first. The field clears as soon as Save is pressed, so
 * the next capture can be typed while the last one is still being stored.
 */
@Stable
class CaptureState(
    private val save: suspend (String) -> String,
    // Outlives the screen, so a capture is still stored if the screen closes mid-save.
    private val scope: CoroutineScope,
    text: String = "",
) {
    var text by mutableStateOf(text)
    val recent = mutableStateListOf<RecentCapture>()
    private var count = 0

    fun submit() {
        val captured = text
        if (captured.isBlank()) return
        text = ""
        val capture = RecentCapture(count++, captured)
        recent.add(0, capture)
        scope.launch(Dispatchers.Main.immediate) {
            capture.result = try {
                CaptureResult.Saved(save(captured))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (text.isEmpty()) text = captured
                CaptureResult.Failed(e.message ?: e.javaClass.simpleName)
            }
        }
    }
}

@Composable
fun rememberCaptureState(app: SalamifocusApp): CaptureState =
    rememberSaveable(
        saver = Saver(save = { it.text }, restore = { CaptureState(app.tasks::captureText, app.scope, it) }),
    ) { CaptureState(app.tasks::captureText, app.scope) }

@Composable
fun CaptureField(state: CaptureState, modifier: Modifier = Modifier, fieldModifier: Modifier = Modifier) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = state.text,
            onValueChange = { state.text = it },
            label = { Text("Capture") },
            maxLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { state.submit() }),
            modifier = fieldModifier.weight(1f).testTag("capture-field"),
        )
        Button(enabled = state.text.isNotBlank(), onClick = state::submit) { Text("Save") }
    }
}

/** What happened to a capture. Success is only claimed once it is stored on this phone. */
@Composable
fun CaptureOutcome(capture: RecentCapture, modifier: Modifier = Modifier) {
    when (val result = capture.result) {
        CaptureResult.Saving -> Text("Saving…", modifier = modifier)
        is CaptureResult.Saved -> Text("Saved on this phone", modifier = modifier)
        is CaptureResult.Failed -> Text(
            "Could not save: ${result.reason}",
            color = MaterialTheme.colorScheme.error,
            modifier = modifier,
        )
    }
}
