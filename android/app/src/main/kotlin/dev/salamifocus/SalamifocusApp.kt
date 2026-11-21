package dev.salamifocus

import android.app.Application
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import dev.salamifocus.data.AppSchema
import dev.salamifocus.data.Connector
import dev.salamifocus.data.ServerApi
import dev.salamifocus.data.SessionStore
import dev.salamifocus.data.Tasks
import dev.salamifocus.data.UploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

class SalamifocusApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var sessions: SessionStore
    lateinit var api: ServerApi
    lateinit var database: PowerSyncDatabase
    lateinit var tasks: Tasks

    override fun onCreate() {
        super.onCreate()
        sessions = SessionStore(this)
        api = ServerApi()
        database = PowerSyncDatabase(
            factory = DatabaseDriverFactory(this),
            schema = AppSchema,
            dbFilename = "salamifocus.db",
        )
        tasks = Tasks(database)

        // Sync whenever there is a session. Signing out stops syncing but keeps
        // local data, including changes that have not uploaded yet.
        scope.launch {
            sessions.session.collect { session ->
                if (session == null) database.disconnect()
                else database.connect(Connector(sessions, api))
            }
        }

        // Whenever there are changes to upload and a session to upload them
        // with, queue a job so they still upload if the app closes first.
        scope.launch {
            combine(tasks.pendingUploads(), sessions.session) { pending, session -> pending > 0 && session != null }
                .distinctUntilChanged()
                .filter { it }
                .collect { UploadWorker.schedule(this@SalamifocusApp) }
        }
    }
}
