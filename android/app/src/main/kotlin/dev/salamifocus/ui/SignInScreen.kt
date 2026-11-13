package dev.salamifocus.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.salamifocus.BuildConfig
import dev.salamifocus.SalamifocusApp
import dev.salamifocus.data.SignInRefusedException
import kotlinx.coroutines.launch

@Composable
fun SignInScreen(app: SalamifocusApp) {
    var serverUrl by remember { mutableStateOf(app.sessions.lastServerUrl ?: BuildConfig.DEFAULT_SERVER_URL) }
    var password by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("salamifocus", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = { Text("Server") },
            placeholder = { Text("https://…") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth().testTag("server-url"),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth().testTag("password"),
        )
        Button(
            enabled = !busy && serverUrl.isNotBlank() && password.isNotEmpty(),
            onClick = {
                busy = true
                problem = null
                scope.launch {
                    try {
                        app.sessions.signedIn(app.api.signIn(serverUrl.trim(), password))
                    } catch (e: SignInRefusedException) {
                        problem = e.message
                    } catch (e: Exception) {
                        problem = "Could not reach the server."
                    } finally {
                        busy = false
                    }
                }
            },
        ) { Text("Sign in") }
        problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
