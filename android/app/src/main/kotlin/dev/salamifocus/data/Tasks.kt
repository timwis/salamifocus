package dev.salamifocus.data

import com.powersync.PowerSyncDatabase
import com.powersync.db.getLong
import com.powersync.db.getString
import com.powersync.db.schema.Column
import com.powersync.db.schema.Schema
import com.powersync.db.schema.Table
import com.powersync.db.schema.TableOptions
import com.powersync.db.schema.TrackPreviousValuesOptions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID

// Rows carry their operation in _metadata, and updates send the values they
// replaced, so the server can attribute changes and later detect conflicts.
private val synced = TableOptions(
    trackMetadata = true,
    trackPreviousValues = TrackPreviousValuesOptions(onlyWhenChanged = true),
    ignoreEmptyUpdates = true,
)

val AppSchema = Schema(
    listOf(
        Table(
            name = "tasks",
            columns = listOf(
                Column.text("title"),
                Column.text("created_at"),
                Column.text("project_id"),
                Column.text("completed_at"),
            ),
            options = synced,
        ),
        Table(
            name = "captures",
            columns = listOf(Column.text("task_id"), Column.text("text"), Column.text("captured_at")),
            options = synced,
        ),
    ),
)

/** Names of logical operations; these match domain/src/operations.ts. */
object OperationName {
    const val CAPTURE_TEXT = "capture_text"
}

fun operationMetadata(op: String, opId: String = UUID.randomUUID().toString()): String =
    buildJsonObject {
        put("op_id", opId)
        put("op", op)
    }.toString()

data class InboxTask(val id: String, val title: String)

class Tasks(private val db: PowerSyncDatabase) {
    /**
     * Saves typed text as a new Inbox task, keeping the text exactly as typed
     * as its original capture. Returns once it is stored on this phone.
     */
    suspend fun captureText(text: String): String {
        require(text.isNotBlank()) { "There is nothing to capture." }
        val taskId = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val metadata = operationMetadata(OperationName.CAPTURE_TEXT)
        db.writeTransaction { tx ->
            tx.execute(
                "INSERT INTO tasks (id, title, created_at, _metadata) VALUES (?, ?, ?, ?)",
                listOf(taskId, text.trim(), now, metadata),
            )
            tx.execute(
                "INSERT INTO captures (id, task_id, text, captured_at, _metadata) VALUES (?, ?, ?, ?, ?)",
                listOf(UUID.randomUUID().toString(), taskId, text, now, metadata),
            )
        }
        return taskId
    }

    fun inbox(): Flow<List<InboxTask>> =
        db.watch("SELECT id, title FROM tasks WHERE project_id IS NULL AND completed_at IS NULL ORDER BY created_at, id") { cursor ->
            InboxTask(id = cursor.getString("id"), title = cursor.getString("title"))
        }

    /** How many local transactions are still waiting to upload. */
    fun pendingUploads(): Flow<Long> =
        db.watch("SELECT count(DISTINCT tx_id) AS pending FROM ps_crud") { cursor -> cursor.getLong("pending") }
            .map { rows -> rows.firstOrNull() ?: 0L }
}
