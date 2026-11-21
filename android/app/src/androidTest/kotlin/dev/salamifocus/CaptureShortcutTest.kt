package dev.salamifocus

import android.content.pm.ShortcutManager
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToLog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.powersync.db.getLong
import dev.salamifocus.ui.CaptureActivity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** The home-screen capture shortcut, signed out so nothing can reach the server. */
@RunWith(AndroidJUnit4::class)
class CaptureShortcutTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val app get() = ApplicationProvider.getApplicationContext<SalamifocusApp>()
    private val run = UUID.randomUUID().toString().take(8)
    private var scenario: ActivityScenario<CaptureActivity>? = null

    @Before
    fun start() {
        app.sessions.clear()
        val shortcut = app.getSystemService(ShortcutManager::class.java).manifestShortcuts.single { it.id == "capture_text" }
        scenario = ActivityScenario.launch(shortcut.intent!!)
    }

    @After
    fun stop() {
        scenario?.close()
        runBlocking { app.database.execute("DROP TRIGGER IF EXISTS fail_local_writes") }
    }

    @Test
    fun theShortcutOpensAFocusedFieldWithTheKeyboardUpAndSavesToTheInbox() {
        compose.onNodeWithTag("capture-field").assertIsFocused()
        waitFor("the keyboard") { keyboardVisible() }

        val text = "book the dentist $run"
        compose.onNodeWithTag("capture-field").performTextInput(text)
        compose.onNodeWithTag("capture-field").performImeAction()
        waitForText("Saved on this phone · sign in to upload")

        assertEquals(1L, count("SELECT count(*) AS n FROM tasks WHERE title = ? AND project_id IS NULL", text))
        assertEquals(1L, count("SELECT count(*) AS n FROM captures WHERE text = ?", text))
        compose.onNodeWithTag("capture-field").assertTextEquals("Capture", "")
    }

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun severalCapturesInQuickSuccessionAllSave() {
        val texts = (1..5).map { "quick capture $it $run" }
        for ((i, text) in texts.withIndex()) {
            compose.onNodeWithTag("capture-field").performTextInput(text)
            // Alternate the button with a hardware keyboard's Enter, which should save rather than add a line.
            if (i % 2 == 0) compose.onNodeWithText("Save").performClick()
            else compose.onNodeWithTag("capture-field").performKeyInput { pressKey(Key.Enter) }
        }
        waitFor("five saves") { compose.onAllNodesWithText("Saved on this phone", substring = true).fetchSemanticsNodes().size == 5 }
        for (text in texts) assertEquals(1L, count("SELECT count(*) AS n FROM tasks WHERE title = ?", text))
    }

    @Test
    fun aCaptureThatCannotBeStoredIsShownAsAFailureAndKeepsTheText() {
        runBlocking {
            app.database.execute(
                "CREATE TRIGGER fail_local_writes BEFORE INSERT ON ps_crud BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
            )
        }
        val text = "this will not save $run"
        compose.onNodeWithTag("capture-field").performTextInput(text)
        compose.onNodeWithText("Save").performClick()

        waitForText("Could not save", substring = true)
        compose.onNodeWithText("Saved on this phone", substring = true).assertDoesNotExist()
        compose.onNodeWithTag("capture-field").assertTextEquals("Capture", text)
        assertEquals(0L, count("SELECT count(*) AS n FROM tasks WHERE title = ?", text))
    }

    private fun keyboardVisible(): Boolean {
        var visible = false
        scenario!!.onActivity {
            visible = ViewCompat.getRootWindowInsets(it.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        }
        return visible
    }

    private fun count(sql: String, parameter: String): Long = runBlocking {
        app.database.get(sql, listOf(parameter)) { it.getLong("n") }
    }

    private fun waitForText(text: String, substring: Boolean = false) =
        waitFor("\"$text\"") { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }

    private fun waitFor(what: String, condition: () -> Boolean) {
        try {
            compose.waitUntil(timeoutMillis = 10_000, condition = condition)
        } catch (e: ComposeTimeoutException) {
            compose.onRoot(useUnmergedTree = true).printToLog("CaptureShortcutTest")
            throw AssertionError("Gave up waiting for $what", e)
        }
        assertTrue(condition())
    }
}
