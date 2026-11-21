package dev.salamifocus

import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToLog
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.powersync.db.getString
import androidx.work.WorkInfo
import androidx.work.WorkManager
import dev.salamifocus.data.Session
import dev.salamifocus.data.UploadWorker
import dev.salamifocus.ui.CaptureActivity
import dev.salamifocus.ui.MainActivity
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * Drives the real app against the real server, Postgres and PowerSync.
 *
 * Instrumentation arguments:
 * - serverUrl: the address the app signs in to (default http://10.0.2.2:3100)
 * - directServerUrl: the server without the network switch in between, used by
 *   the simulated web client (defaults to serverUrl)
 * - networkControl: the network switch's control address; offline tests are
 *   skipped without it
 * - password: the owner password (default "salami")
 */
@RunWith(AndroidJUnit4::class)
class CaptureToInboxTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val args = InstrumentationRegistry.getArguments()
    private val serverUrl = args.getString("serverUrl") ?: "http://10.0.2.2:3100"
    private val directServerUrl = args.getString("directServerUrl") ?: serverUrl
    private val networkControl = args.getString("networkControl")
    private val password = args.getString("password") ?: "salami"
    private val app get() = ApplicationProvider.getApplicationContext<SalamifocusApp>()
    private val run = UUID.randomUUID().toString().take(8)
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun start() {
        network("online")
        app.sessions.clear()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        signIn()
    }

    @After
    fun stop() {
        scenario?.close()
        network("online")
    }

    @Test
    fun aCaptureReachesTheServerAndARenameOnTheWebComesBack() {
        val captured = "buy oat milk $run"
        capture(captured)
        waitForTask(captured)
        waitForText("All changes uploaded", substring = true)

        val web = SimulatedWebClient.signIn(directServerUrl, password)
        // The rename only applies if the capture already exists on the server.
        assertEquals("applied", web.rename(localTaskId(captured), "Buy oat milk, renamed on the web $run"))

        waitForTask("Buy oat milk, renamed on the web $run")
    }

    @Test
    fun aCaptureSavedOfflineUploadsOnReconnectionAndConvergesWithTheWeb() {
        assumeTrue("Needs the networkControl argument", networkControl != null)
        val first = "call the garage $run"
        capture(first)
        waitForText("All changes uploaded", substring = true)

        network("offline")
        waitForText("Offline", substring = true)
        val second = "renew parking permit $run"
        capture(second)
        waitForTask(second, waitingToUpload = true)
        compose.onNodeWithTag("capture-message").assertTextEquals("Saved on this phone")
        waitForText("1 change waiting to upload", substring = true)
        assertTrue("An upload job should be waiting", uploadJobs().any { !it.isFinished })

        // Meanwhile the web, which is still online, rewords the first capture.
        val web = SimulatedWebClient.signIn(directServerUrl, password)
        assertEquals("applied", web.rename(localTaskId(first), "Call the garage about the MOT $run"))
        assertEquals("rejected", web.rename(localTaskId(second), "Not uploaded yet"))

        network("online")
        waitForText("All changes uploaded", substring = true)
        compose.onNodeWithTag("capture-message").assertTextEquals("Uploaded")
        compose.waitUntil(timeoutMillis = 30_000) { uploadJobs().all { it == WorkInfo.State.SUCCEEDED } }
        waitForTask(second, waitingToUpload = false)
        waitForTask("Call the garage about the MOT $run")
        assertEquals("applied", web.rename(localTaskId(second), "Renew the parking permit $run"))
        waitForTask("Renew the parking permit $run")
    }

    @Test
    fun aCaptureFromTheShortcutWithAnExpiredSessionUploadsAfterSigningInAgain() {
        app.sessions.signedIn(Session(serverUrl, "expired-$run"))
        waitForText("Sign in")
        scenario?.close()

        val captured = "post the birthday card $run"
        ActivityScenario.launch(CaptureActivity::class.java).use {
            compose.onNodeWithTag("capture-field").performTextInput(captured)
            compose.onNodeWithText("Save").performClick()
            waitForText("Saved on this phone · sign in to upload")
        }

        scenario = ActivityScenario.launch(MainActivity::class.java)
        signIn()
        waitForTask(captured, waitingToUpload = false)
        val web = SimulatedWebClient.signIn(directServerUrl, password)
        assertEquals("applied", web.rename(localTaskId(captured), "Post the birthday card, renamed $run"))
        waitForTask("Post the birthday card, renamed $run")
    }

    private fun signIn() {
        compose.onNodeWithTag("server-url").performTextReplacement(serverUrl)
        compose.onNodeWithTag("password").performTextInput(password)
        compose.onNodeWithText("Sign in").performClick()
        waitForText("Inbox")
    }

    private fun capture(text: String) {
        compose.onNodeWithTag("capture-field").performTextInput(text)
        compose.onNodeWithText("Save").performClick()
    }

    /** Waits for a task to be in the Inbox, scrolling the list to it, and optionally for its upload state. */
    private fun waitForTask(title: String, waitingToUpload: Boolean? = null) {
        val row = when (waitingToUpload) {
            null -> hasText(title)
            true -> hasText(title) and hasText("Waiting to upload")
            false -> hasText(title) and !hasText("Waiting to upload")
        }
        try {
            compose.waitUntil(timeoutMillis = 30_000) {
                runCatching { compose.onNodeWithTag("inbox").performScrollToNode(row) }.isSuccess &&
                    compose.onAllNodes(row).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (e: ComposeTimeoutException) {
            compose.onRoot(useUnmergedTree = true).printToLog("CaptureToInboxTest")
            throw AssertionError("\"$title\" never appeared in the Inbox", e)
        }
    }

    private fun waitForText(text: String, substring: Boolean = false) {
        try {
            compose.waitUntil(timeoutMillis = 30_000) {
                compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (e: ComposeTimeoutException) {
            compose.onRoot(useUnmergedTree = true).printToLog("CaptureToInboxTest")
            throw AssertionError("\"$text\" never appeared", e)
        }
    }

    /** The states of the background jobs that keep the app alive to upload. */
    private fun uploadJobs(): List<WorkInfo.State> =
        WorkManager.getInstance(app).getWorkInfosForUniqueWork(UploadWorker.NAME).get().map { it.state }

    private fun localTaskId(title: String): String = runBlocking {
        app.database.get("SELECT id FROM tasks WHERE title = ?", listOf(title)) { it.getString("id") }
    }

    private fun network(state: String) {
        val control = networkControl ?: return
        val request = Request.Builder().url("$control/$state").post(ByteArray(0).toRequestBody()).build()
        OkHttpClient().newCall(request).execute().close()
    }
}
