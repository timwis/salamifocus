package dev.salamifocus.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Session(val serverUrl: String, val token: String)

/** The signed-in session, kept in app-private storage across restarts. */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(read())

    val session: StateFlow<Session?> = state.asStateFlow()

    val lastServerUrl: String? get() = prefs.getString(KEY_SERVER_URL, null)

    fun signedIn(session: Session) {
        prefs.edit().putString(KEY_SERVER_URL, session.serverUrl).putString(KEY_TOKEN, session.token).commit()
        state.value = session
    }

    /** Forgets the session. Local tasks and changes still waiting to upload are kept. */
    fun clear() {
        prefs.edit().remove(KEY_TOKEN).commit()
        state.value = null
    }

    private fun read(): Session? {
        val url = prefs.getString(KEY_SERVER_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return Session(url, token)
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_TOKEN = "token"
    }
}
