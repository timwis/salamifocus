import {
  buildTagTree,
  buildTree,
  deferredUntilColumn,
  dueByColumn,
  groupByTag,
  inboxCondition,
  outlineTasks,
  placedTags,
  projectsInSelection,
  tagBranch,
  unavailability,
  type OrganisationNode,
  type TagNode,
} from '@salamifocus/domain';
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
  ProjectOutline,
  TagOutline,
  TaskView,
} from './types.ts';

export { Rejection } from './rejection.ts';
export type * from './types.ts';

export interface ApplicationOptions {
  sql: Sql;
  clock?: () => Date;
}

export type Application = ReturnType<typeof createApplication>;

/** How many of a task's children (aliased `t`) are unfinished, which is what makes it blocked. The web client counts them the same way, in web/src/queries.ts. */
const unfinishedChildren = (sql: Sql) =>
  sql`(SELECT count(*) FROM tasks c WHERE c.parent_id = t.id AND c.completed_at IS NULL)::int AS "unfinishedChildren"`;

/** The latest defer date among a task (aliased `t`) and the tasks it is beneath, as the clients work it out. */
const deferredUntil = (sql: Sql) => sql.unsafe(deferredUntilColumn);

/** The earliest due date among a task (aliased `t`) and the tasks it is beneath. */
const dueBy = (sql: Sql) => sql.unsafe(dueByColumn);

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
            after: change.after ? tx.json(change.after) : null,
          })}`;
      }
      return { opId, outcome: 'applied', duplicate: false };
    }) as Promise<OperationResult>;
  }

  /** Unfinished tasks still lacking a project or a tag, oldest first. */
  async function inbox(): Promise<InboxEntry[]> {
    return sql<InboxEntry[]>`
      SELECT t.id, t.title, t.created_at AS "createdAt" FROM tasks t WHERE ${sql.unsafe(inboxCondition)} ORDER BY t.created_at, t.id`;
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

  /** Tags as the Tags sidebar nests them. */
  async function tags(): Promise<TagNode[]> {
    const rows = await sql`SELECT id, name, parent_id, position FROM tags`;
    return buildTagTree(rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id, position: t.position })));
  }

  /**
   * What the Tags perspective shows for a selected tag: unfinished tasks
   * carrying the tag or any tag beneath it, grouped under each matching tag
   * (so a task can appear more than once), oldest first within a group.
   */
  async function tagged(tagId: string): Promise<TagOutline[]> {
    const tree = await tags();
    const placed = tagBranch(tree, tagId);
    const branch = placed.map((p) => p.tag.id);
    if (branch.length === 0) return [];
    const now = clock();
    const rows = await sql<
      {
        id: string;
        title: string;
        note: string;
        projectId: string | null;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        tagId: string;
        unfinishedChildren: number;
        deferredUntil: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", t.defer_until AS "deferUntil", t.due_at AS "dueAt", tt.tag_id AS "tagId",
             ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}
      FROM tasks t JOIN task_tags tt ON tt.task_id = t.id
      WHERE t.completed_at IS NULL AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN ${sql(branch)})
      ORDER BY t.created_at, t.id`;
    const tasks = new Map<string, TagOutline['tasks'][number]>();
    for (const { tagId: rowTag, unfinishedChildren, deferredUntil, ...task } of rows) {
      const existing = tasks.get(task.id);
      if (existing) existing.tagIds.push(rowTag);
      else tasks.set(task.id, { ...task, tagIds: [rowTag], unavailable: unavailability({ completedAt: null, unfinishedChildren, deferredUntil }, now) });
    }
    return groupByTag(placed, [...tasks.values()], (task) => task.tagIds).map(({ tag, path, tasks }) => ({
      tag: { id: tag.id, name: tag.name, path },
      tasks,
    }));
  }

  /**
   * What the Projects perspective shows for a sidebar selection: each selected
   * project (every project inside a selected folder), in sidebar order, with
   * its unfinished tasks in outline order, each followed by its prerequisites.
   */
  async function projects(selection: string[]): Promise<ProjectOutline[]> {
    const selected = projectsInSelection(await organisation(), selection);
    if (selected.length === 0) return [];
    const now = clock();
    const rows = await sql<
      {
        id: string;
        title: string;
        note: string;
        projectId: string;
        parentId: string | null;
        position: string | null;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        unfinishedChildren: number;
        deferredUntil: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", t.parent_id AS "parentId", t.position, t.defer_until AS "deferUntil", t.due_at AS "dueAt",
             ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}
      FROM tasks t WHERE t.project_id IN ${sql(selected.map((p) => p.id))} AND t.completed_at IS NULL`;
    return selected.map((project) => ({
      project: { id: project.id, name: project.name, kind: project.kind },
      tasks: outlineTasks(rows.filter((row) => row.projectId === project.id)).map(({ task, depth, parentId }) => ({
        id: task.id,
        title: task.title,
        note: task.note,
        parentId,
        depth,
        deferUntil: task.deferUntil,
        dueAt: task.dueAt,
        dueBy: task.dueBy,
        unavailable: unavailability({ completedAt: null, unfinishedChildren: task.unfinishedChildren, deferredUntil: task.deferredUntil }, now),
      })),
    }));
  }

  async function task(id: string): Promise<TaskView | null> {
    const [[row], tagRows, tree] = await Promise.all([
      sql`
        SELECT t.id, t.title, t.note, t.created_at, t.project_id, t.parent_id, t.completed_at, t.defer_until, t.due_at, c.id AS capture_id, c.text, c.captured_at,
               ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}
        FROM tasks t LEFT JOIN captures c ON c.task_id = t.id
        WHERE t.id = ${id}::uuid`,
      sql<{ tag_id: string }[]>`SELECT tag_id FROM task_tags WHERE task_id = ${id}::uuid`,
      tags(),
    ]);
    if (!row) return null;
    const tagIds = new Set(tagRows.map((r) => r.tag_id));
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      createdAt: row.created_at,
      projectId: row.project_id,
      parentId: row.parent_id,
      completedAt: row.completed_at,
      deferUntil: row.defer_until,
      dueAt: row.due_at,
      dueBy: row.dueBy,
      unavailable: unavailability(
        { completedAt: row.completed_at, unfinishedChildren: row.unfinishedChildren, deferredUntil: row.deferredUntil },
        clock(),
      ),
      tags: placedTags(tree)
        .filter((p) => tagIds.has(p.tag.id))
        .map((p) => ({ id: p.tag.id, name: p.tag.name, path: p.path })),
      capture: row.capture_id ? { id: row.capture_id, text: row.text, capturedAt: row.captured_at } : null,
    };
  }

  /** Applied operations that changed the task, its capture or its tags, oldest first. */
  async function history(taskId: string): Promise<HistoryEntry[]> {
    const rows = await sql`
      SELECT o.id AS op_id, o.name, o.actor_type, o.actor_id, o.source, o.recorded_at,
             ch.entity, ch.entity_id, ch.kind, ch.before, ch.after
      FROM changes ch JOIN operations o ON o.id = ch.operation_id
      WHERE (ch.entity = 'task' AND ch.entity_id = ${taskId}::uuid)
         OR (ch.entity = 'capture' AND ch.entity_id IN (SELECT id FROM captures WHERE task_id = ${taskId}::uuid))
         OR (ch.entity = 'task_tag' AND COALESCE(ch.after, ch.before)->>'task_id' = ${taskId})
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

  return { execute, inbox, organisation, projects, tags, tagged, task, history, operation };
}
