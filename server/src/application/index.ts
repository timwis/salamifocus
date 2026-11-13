import { buildTree, type OrganisationNode } from '@salamifocus/domain';
import type { Sql } from '../db.ts';
import { Mutations } from './mutations.ts';
import { findOperation } from './operations.ts';
import { Rejection } from './rejection.ts';
import type {
  Actor,
  HistoryEntry,
  InboxEntry,
  OperationRecord,
  OperationRequest,
  OperationResult,
  TaskView,
} from './types.ts';

export { Rejection } from './rejection.ts';
export type * from './types.ts';

export interface ApplicationOptions {
  sql: Sql;
  clock?: () => Date;
}

export type Application = ReturnType<typeof createApplication>;

/**
 * The application's public operations and queries. Every adapter (the sync
 * upload endpoint now, the agent API later) goes through these, and the test
 * harness drives them directly.
 */
export function createApplication({ sql, clock = () => new Date() }: ApplicationOptions) {
  async function execute(request: OperationRequest): Promise<OperationResult> {
    const { opId, name, actor } = request;
    return sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${opId}, 0))`;
      const [existing] = await tx<{ outcome: 'applied' | 'rejected'; code: string | null; reason: string | null }[]>`
        UPDATE operations SET deliveries = deliveries + 1 WHERE id = ${opId}
        RETURNING outcome, rejection_code AS code, rejection_reason AS reason`;
      if (existing) {
        return existing.outcome === 'applied'
          ? { opId, outcome: 'applied', duplicate: true }
          : { opId, outcome: 'rejected', code: existing.code ?? '', reason: existing.reason ?? '', duplicate: true };
      }

      const now = clock().toISOString();
      let mutations: Mutations | null = null;
      let rejection: Rejection | null = null;
      try {
        await tx.savepoint(async (sp) => {
          if (request.invalid) throw new Rejection(request.invalid.code, request.invalid.reason);
          const definition = findOperation(name);
          if (!definition) throw new Rejection('unknown_operation', `"${name}" is not an operation.`);
          mutations = new Mutations(sp, now);
          await definition.apply(mutations, definition.parse(request.args, now));
        });
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
        rejection = error;
      }

      await tx`
        INSERT INTO operations ${tx({
          id: opId,
          name,
          actor_type: actor.type,
          actor_id: actor.id,
          session_id: request.sessionId ?? null,
          source: request.source ?? null,
          outcome: rejection ? 'rejected' : 'applied',
          rejection_code: rejection?.code ?? null,
          rejection_reason: rejection?.message ?? null,
          submitted: tx.json((request.submitted ?? request.args ?? null) as never),
          recorded_at: now,
        })}`;

      if (rejection) return { opId, outcome: 'rejected', code: rejection.code, reason: rejection.message, duplicate: false };

      for (const change of (mutations as Mutations | null)?.changes ?? []) {
        await tx`
          INSERT INTO changes ${tx({
            operation_id: opId,
            entity: change.entity,
            entity_id: change.entityId,
            kind: change.kind,
            before: change.before ? tx.json(change.before) : null,
            after: tx.json(change.after),
          })}`;
      }
      return { opId, outcome: 'applied', duplicate: false };
    }) as Promise<OperationResult>;
  }

  async function inbox(): Promise<InboxEntry[]> {
    return sql<InboxEntry[]>`
      SELECT id, title, created_at AS "createdAt" FROM tasks ORDER BY created_at, id`;
  }

  /** Folders, projects and single-action lists as the Projects sidebar nests them. */
  async function organisation(): Promise<OrganisationNode[]> {
    const [folders, projects] = await Promise.all([
      sql`SELECT id, name, parent_id, position FROM folders`,
      sql`SELECT id, name, kind, folder_id, position FROM projects`,
    ]);
    return buildTree(
      folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, position: f.position })),
      projects.map((p) => ({ id: p.id, name: p.name, kind: p.kind, folderId: p.folder_id, position: p.position })),
    );
  }

  async function task(id: string): Promise<TaskView | null> {
    const [row] = await sql`
      SELECT t.id, t.title, t.created_at, c.id AS capture_id, c.text, c.captured_at
      FROM tasks t LEFT JOIN captures c ON c.task_id = t.id
      WHERE t.id = ${id}::uuid`;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      capture: row.capture_id ? { id: row.capture_id, text: row.text, capturedAt: row.captured_at } : null,
    };
  }

  /** Applied operations that changed the task or its capture, oldest first. */
  async function history(taskId: string): Promise<HistoryEntry[]> {
    const rows = await sql`
      SELECT o.id AS op_id, o.name, o.actor_type, o.actor_id, o.source, o.recorded_at,
             ch.entity, ch.entity_id, ch.kind, ch.before, ch.after
      FROM changes ch JOIN operations o ON o.id = ch.operation_id
      WHERE (ch.entity = 'task' AND ch.entity_id = ${taskId}::uuid)
         OR (ch.entity = 'capture' AND ch.entity_id IN (SELECT id FROM captures WHERE task_id = ${taskId}::uuid))
      ORDER BY o.recorded_at, ch.id`;
    const entries = new Map<string, HistoryEntry>();
    for (const row of rows) {
      let entry = entries.get(row.op_id);
      if (!entry) {
        entry = {
          opId: row.op_id,
          operation: row.name,
          actor: { type: row.actor_type, id: row.actor_id } as Actor,
          source: row.source,
          recordedAt: row.recorded_at,
          changes: [],
        };
        entries.set(row.op_id, entry);
      }
      entry.changes.push({ entity: row.entity, entityId: row.entity_id, kind: row.kind, before: row.before, after: row.after });
    }
    return [...entries.values()];
  }

  async function operation(opId: string): Promise<OperationRecord | null> {
    const [row] = await sql`SELECT * FROM operations WHERE id = ${opId}`;
    if (!row) return null;
    return {
      opId: row.id,
      operation: row.name,
      actor: { type: row.actor_type, id: row.actor_id } as Actor,
      source: row.source,
      outcome: row.outcome,
      rejectionCode: row.rejection_code,
      rejectionReason: row.rejection_reason,
      submitted: row.submitted,
      deliveries: row.deliveries,
      recordedAt: row.recorded_at,
    };
  }

  return { execute, inbox, organisation, task, history, operation };
}
