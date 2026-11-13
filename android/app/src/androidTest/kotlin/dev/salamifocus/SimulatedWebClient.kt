package dev.salamifocus

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

/**
 * Another signed-in client, standing in for the desktop web client, that
 * writes through the real upload endpoint exactly as its sync queue would.
 */
class SimulatedWebClient private constructor(private val serverUrl: String, private val token: String) {
    /** Renames a task and returns the server's outcome ("applied" or "rejected"). */
    fun rename(taskId: String, title: String): String {
        val metadata = buildJsonObject {
            put("op_id", UUID.randomUUID().toString())
            put("op", "rename_task")
        }.toString()
        val body = buildJsonObject {
            put("entries", buildJsonArray {
                add(buildJsonObject {
                    put("op", "PATCH")
                    put("table", "tasks")
                    put("id", taskId)
                    putJsonObject("data") { put("title", title) }
                    put("metadata", metadata)
                })
            })
        }
        val response = post(serverUrl, "/api/sync/upload", body.toString(), token)
        return Json.parseToJsonElement(response).jsonObject["results"]!!.jsonArray[0].jsonObject["outcome"]!!.jsonPrimitive.content
    }

    companion object {
        private val http = OkHttpClient()

        fun signIn(serverUrl: String, password: String): SimulatedWebClient {
            val body = buildJsonObject {
                put("password", password)
                put("client", "web-simulated")
            }
            val response = post(serverUrl, "/api/auth/sign-in", body.toString(), null)
            return SimulatedWebClient(serverUrl, Json.parseToJsonElement(response).jsonObject["token"]!!.jsonPrimitive.content)
        }

        private fun post(serverUrl: String, path: String, json: String, token: String?): String {
            val request = Request.Builder()
                .url(serverUrl + path)
                .post(json.toRequestBody("application/json".toMediaType()))
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .build()
            http.newCall(request).execute().use { response ->
                check(response.isSuccessful) { "$path failed with ${response.code}" }
                return response.body.string()
            }
        }
    }
}
