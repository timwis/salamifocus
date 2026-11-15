import {
  column,
  PowerSyncDatabase,
  Schema,
  SyncStreamConnectionMethod,
  Table,
  type AbstractPowerSyncDatabase,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
} from '@powersync/web';
import { sessionExpired, sessionToken } from './session.ts';

// Rows carry their operation in _metadata, and updates send the values they
// replaced, so the server can attribute changes and later detect conflicts.
const synced = { trackMetadata: true, trackPrevious: { onlyWhenChanged: true }, ignoreEmptyUpdates: true };

export const schema = new Schema({
  tasks: new Table(
    {
      title: column.text,
      created_at: column.text,
      project_id: column.text,
      parent_id: column.text,
      position: column.text,
      note: column.text,
      completed_at: column.text,
      defer_until: column.text,
    },
    { ...synced, indexes: { parent: ['parent_id'] } },
  ),
  captures: new Table({ task_id: column.text, text: column.text, captured_at: column.text }, synced),
  folders: new Table({ name: column.text, parent_id: column.text, position: column.text }, synced),
  projects: new Table({ name: column.text, kind: column.text, folder_id: column.text, position: column.text }, synced),
  tags: new Table({ name: column.text, parent_id: column.text, position: column.text }, synced),
  // Indexed by task, since the Inbox checks each task for a tag.
  task_tags: new Table({ task_id: column.text, tag_id: column.text }, { ...synced, indexes: { task: ['task_id'] } }),
});

export const db = new PowerSyncDatabase({
  schema,
  database: { dbFilename: 'salamifocus.db' },
});

class Connector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const response = await authorisedFetch('/api/sync/token', { method: 'POST' });
    const { token } = (await response.json()) as { token: string };
    return { endpoint: new URL('/powersync', location.origin).toString(), token };
  }

  // Sends one local transaction at a time, in order. Throwing leaves it at the
  // head of the queue to be retried, so only faults throw; refusals come back
  // as 200 and are reverted by the next sync.
  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const entries = transaction.crud.map((entry) => ({
      op: entry.op,
      table: entry.table,
      id: entry.id,
      data: entry.opData ?? null,
      old: entry.previousValues ?? null,
      metadata: entry.metadata ?? null,
    }));
    await authorisedFetch('/api/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    await transaction.complete();
  }
}

async function authorisedFetch(path: string, init: RequestInit): Promise<Response> {
  const token = sessionToken();
  if (!token) throw new Error('Not signed in.');
  const response = await fetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    sessionExpired();
    throw new Error('The session has ended.');
  }
  if (!response.ok) throw new Error(`${path} failed with ${response.status}.`);
  return response;
}

export function connect(): Promise<void> {
  // The server proxies sync over HTTP; WebSockets would not pass through it.
  return db.connect(new Connector(), { connectionMethod: SyncStreamConnectionMethod.HTTP });
}
