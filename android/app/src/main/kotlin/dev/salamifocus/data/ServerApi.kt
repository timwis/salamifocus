package dev.salamifocus.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class SessionEndedException : IOException("The server no longer accepts this session.")

class WrongPasswordException : IOException("That password is not right.")

/** The app server's HTTP endpoints. Sync itself goes through the PowerSync SDK. */
class ServerApi(
    private val http: OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build(),
) {
    suspend fun signIn(serverUrl: String, password: String): Session {
        val body = buildJsonObject {
            put("password", password)
            put("client", "android")
        }
        val response = post(serverUrl, "/api/auth/sign-in", body.toString(), token = null)
        val token = Json.parseToJsonElement(response).jsonObject["token"]!!.jsonPrimitive.content
        return Session(serverUrl, token)
    }

    suspend fun signOut(session: Session) {
        runCatching { post(session.serverUrl, "/api/auth/sign-out", "{}", session.token) }
    }

    suspend fun syncToken(session: Session): String {
        val response = post(session.serverUrl, "/api/sync/token", "{}", session.token)
        return Json.parseToJsonElement(response).jsonObject["token"]!!.jsonPrimitive.content
    }

    suspend fun upload(session: Session, entries: JsonArray) {
        val body = buildJsonObject { put("entries", entries) }
        post(session.serverUrl, "/api/sync/upload", body.toString(), session.token)
    }

    private suspend fun post(serverUrl: String, path: String, json: String, token: String?): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(serverUrl.trimEnd('/') + path)
                .post(json.toRequestBody("application/json".toMediaType()))
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .build()
            http.newCall(request).execute().use { response ->
                when {
                    response.code == 401 && token == null -> throw WrongPasswordException()
                    response.code == 401 -> throw SessionEndedException()
                    !response.isSuccessful -> throw IOException("$path failed with ${response.code}")
                    else -> response.body.string()
                }
            }
        }
}
