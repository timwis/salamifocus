package dev.salamifocus.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.powersync.sync.SyncStatusData
import dev.salamifocus.SalamifocusApp
import kotlinx.coroutines.launch

@Composable
fun InboxScreen(app: SalamifocusApp) {
    val inbox by remember { app.tasks.inbox() }.collectAsStateWithLifecycle(initialValue = emptyList())
    val pending by remember { app.tasks.pendingUploads() }.collectAsStateWithLifecycle(initialValue = 0L)
    val status by remember { app.database.currentStatus.asFlow() }.collectAsStateWithLifecycle(initialValue = null)
    val capture = rememberCaptureState(app)
    val scope = rememberCoroutineScope()

    Column(modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Inbox", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = {
                val session = app.sessions.session.value
                app.sessions.clear()
                if (session != null) scope.launch { app.api.signOut(session) }
            }) { Text("Sign out") }
        }
        Text(
            describe(status, pending),
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("sync-status"),
        )
        CaptureField(capture, modifier = Modifier.padding(vertical = 12.dp))
        capture.recent.firstOrNull()?.let {
            CaptureOutcome(app, it, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("capture-message"))
        }
        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f).testTag("inbox")) {
            items(inbox, key = { it.id }) { task ->
                Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp).semantics(mergeDescendants = true) {}) {
                    Text(task.title)
                    if (task.waitingToUpload) {
                        Text("Waiting to upload", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

private fun describe(status: SyncStatusData?, pending: Long): String {
    val connection = if (status?.connected == true) "Online" else "Offline"
    val uploads = when (pending) {
        0L -> "All changes uploaded"
        1L -> "1 change waiting to upload"
        else -> "$pending changes waiting to upload"
    }
    return "$connection · $uploads"
}
