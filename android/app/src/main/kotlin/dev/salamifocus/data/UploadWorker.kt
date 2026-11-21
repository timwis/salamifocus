package dev.salamifocus.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.salamifocus.SalamifocusApp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration.Companion.minutes

/**
 * Keeps the app running while changes upload, once the phone has a network.
 * The upload itself is PowerSync's, started when the app connects; this job
 * gives it a process to run in after the app has closed or been killed.
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as SalamifocusApp
        // Nothing can upload without a session; signing in schedules this again.
        if (app.sessions.session.value == null) return Result.success()
        val uploaded = withTimeoutOrNull(5.minutes) { app.tasks.pendingUploads().first { it == 0L } }
        return if (uploaded != null) Result.success() else Result.retry()
    }

    companion object {
        const val NAME = "upload"

        // Queues a job after any existing one, so a job always starts after the latest change.
        // Replacing would cancel the job that started the process, since start-up schedules again.
        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
