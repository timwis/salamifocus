package dev.salamifocus.data

import com.powersync.PowerSyncDatabase
import com.powersync.connectors.PowerSyncBackendConnector
import com.powersync.connectors.PowerSyncCredentials
import com.powersync.db.crud.CrudEntry
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class Connector(
    private val sessions: SessionStore,
    private val api: ServerApi,
) : PowerSyncBackendConnector() {
    override suspend fun fetchCredentials(): PowerSyncCredentials? {
        val session = sessions.session.value ?: return null
        val token = signedOutOnEnd { api.syncToken(session) }
        return PowerSyncCredentials(endpoint = session.serverUrl.trimEnd('/') + "/powersync", token = token)
    }

    // Sends one local transaction at a time, in order. Throwing leaves it at
    // the head of the queue to be retried, so only faults throw; refusals come
    // back as 200 and are reverted by the next sync.
    override suspend fun uploadData(database: PowerSyncDatabase) {
        val transaction = database.getNextCrudTransaction() ?: return
        val session = sessions.session.value ?: error("Not signed in.")
        signedOutOnEnd { api.upload(session, buildJsonArray { transaction.crud.forEach { add(it.toJson()) } }) }
        transaction.complete(null)
    }

    private suspend fun <T> signedOutOnEnd(block: suspend () -> T): T =
        try {
            block()
        } catch (e: SessionEndedException) {
            sessions.clear()
            throw e
        }
}

private fun CrudEntry.toJson() = buildJsonObject {
    put("op", op.toJson())
    put("table", table)
    put("id", id)
    put("data", opData?.jsonValues ?: JsonNull)
    put("old", previousValues?.jsonValues ?: JsonNull)
    put("metadata", metadata)
}
