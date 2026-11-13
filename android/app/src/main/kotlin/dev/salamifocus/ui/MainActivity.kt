package dev.salamifocus.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.salamifocus.SalamifocusApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as SalamifocusApp
        setContent {
            MaterialTheme {
                val session by app.sessions.session.collectAsStateWithLifecycle()
                if (session == null) SignInScreen(app) else InboxScreen(app)
            }
        }
    }
}
