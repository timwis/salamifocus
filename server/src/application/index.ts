import {
  actionableView,
  buildTagTree,
  buildTree,
  deferredUntilColumn,
  dueByColumn,
  flaggedCondition,
  groupByTag,
  inboxCondition,
  outlineTasks,
  placedTags,
  projectStatusColumn,
  projectStatusOf,
  scopeFolderColumn,
  settingsId,
  projectsInSelection,
  pruneOutline,
  shownUnder,
  tagBranch,
  unavailability,
  visibilityCondition,
  Visibility,
  type FolderScope,
  type OrganisationNode,
  type TagNode,
} from '@salamifocus/domain';
import type { Sql } from '../db.ts';
import { Mutations } from './mutations.ts';
import { findOperation } from './operations.ts';
import { Rejection } from './rejection.ts';
import type {
  ActionableOutline,
  Actor,
  HistoryEntry,
  InboxEntry,
  OperationRecord,
  OperationRequest,
  OperationResult,
  FlaggedTask,
  ProjectOutline,
  Settings,
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

/** The latest defer date among a task (aliased `t`), the unfinished tasks it is beneath and its project, as the clients work it out. */
const deferredUntil = (sql: Sql) => sql.unsafe(deferredUntilColumn);

/** The earliest due date among a task (aliased `t`), the unfinished tasks it is beneath and its project. */
const dueBy = (sql: Sql) => sql.unsafe(dueByColumn);

/** The status of a task's (aliased `t`) project, or null when it has none. */
const projectStatus = (sql: Sql) => sql.unsafe(projectStatusColumn);

/** Limits tasks (aliased `t`) to unfinished ones, except under Everything, as the clients do. */
const unfinishedUnless = (sql: Sql, visibility: Visibility) => sql.unsafe(visibilityCondition(visibility));

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
      sql`SELECT id, name, kind, status, folder_id, position FROM projects`,
    ]);
    return buildTree(
      folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, position: f.position })),
      projects.map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: projectStatusOf(p.status), folderId: p.folder_id, position: p.position })),
    );
  }

  /** Tags as the Tags sidebar nests them. */
  async function tags(): Promise<TagNode[]> {
    const rows = await sql`SELECT id, name, parent_id, position FROM tags`;
    return buildTagTree(rows.map((t) => ({ id: t.id, name: t.name, parentId: t.parent_id, position: t.position })));
  }

  /**
   * What the Tags perspective shows for a selected tag: the tasks the
   * visibility shows that carry the tag or any tag beneath it, grouped under
   * each matching tag (so a task can appear more than once), oldest first
   * within a group.
   */
  async function tagged(tagId: string, visibility: Visibility = Visibility.remaining): Promise<TagOutline[]> {
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
        completedAt: string | null;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        flagged: boolean;
        tagId: string;
        unfinishedChildren: number;
        deferredUntil: string | null;
        projectStatus: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", t.completed_at AS "completedAt", t.defer_until AS "deferUntil", t.due_at AS "dueAt", t.flagged,
             tt.tag_id AS "tagId", ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}, ${projectStatus(sql)}
      FROM tasks t JOIN task_tags tt ON tt.task_id = t.id
      WHERE ${unfinishedUnless(sql, visibility)} AND t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN ${sql(branch)})
      ORDER BY t.created_at, t.id`;
    const tasks = new Map<string, TagOutline['tasks'][number]>();
    for (const { tagId: rowTag, unfinishedChildren, deferredUntil, projectStatus, ...task } of rows) {
      const existing = tasks.get(task.id);
      if (existing) existing.tagIds.push(rowTag);
      else tasks.set(task.id, { ...task, tagIds: [rowTag], unavailable: unavailability({ completedAt: task.completedAt, unfinishedChildren, deferredUntil, projectStatus }, now) });
    }
    const shown = [...tasks.values()].filter((task) => shownUnder(visibility, task.unavailable));
    return groupByTag(placed, shown, (task) => task.tagIds).map(({ tag, path, tasks }) => ({
      tag: { id: tag.id, name: tag.name, path },
      tasks,
    }));
  }

  /** The user's settings: which folder each Actionable perspective shows. */
  async function settings(): Promise<Settings> {
    const [row] = await sql<{ personal: string | null; work: string | null }[]>`
      SELECT ${sql(scopeFolderColumn.personal)} AS personal, ${sql(scopeFolderColumn.work)} AS work FROM settings WHERE id = ${settingsId}`;
    return { folders: { personal: row?.personal ?? null, work: row?.work ?? null } };
  }

  /**
   * What Actionable — Personal or Actionable — Work shows: the available tasks in the designated folder and
   * everything inside it, grouped by tag in sidebar order (a task under each of its tags), oldest first within a
   * group. With no tag selected, every group shows, then the tasks with no tag; selecting a tag shows its branch,
   * and selecting `untaggedId` only the untagged tasks. The sidebar holds only the tags with available tasks and
   * their ancestors (and the selected tag). Empty when no folder is designated.
   */
  async function actionable(scope: FolderScope, selected: string | null = null): Promise<ActionableOutline> {
    const [{ folders }, tree, tagTree] = await Promise.all([settings(), organisation(), tags()]);
    const folderId = folders[scope];
    const projectIds = folderId ? projectsInSelection(tree, [folderId]).map((p) => p.id) : [];
    if (folderId === null || projectIds.length === 0) return { folderId, sidebar: actionableView(tagTree, selected, [], () => []).sidebar, groups: [] };
    const now = clock();
    const rows = await sql<
      {
        id: string;
        title: string;
        note: string;
        projectId: string;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        tagIds: string[];
        unfinishedChildren: number;
        deferredUntil: string | null;
        projectStatus: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", t.defer_until AS "deferUntil", t.due_at AS "dueAt",
             ARRAY(SELECT tt.tag_id FROM task_tags tt WHERE tt.task_id = t.id) AS "tagIds",
             ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}, ${projectStatus(sql)}
      FROM tasks t WHERE ${unfinishedUnless(sql, Visibility.available)} AND t.project_id IN ${sql(projectIds)}
      ORDER BY t.created_at, t.id`;
    const available = rows
      .filter((row) => shownUnder(Visibility.available, unavailability({ ...row, completedAt: null }, now)))
      .map(({ unfinishedChildren, deferredUntil, projectStatus, ...task }) => task);
    const { groups, sidebar } = actionableView(tagTree, selected, available, (task) => task.tagIds);
    return {
      folderId,
      sidebar,
      groups: groups.map(({ tag, tasks }) => ({
        tag: tag && { id: tag.tag.id, name: tag.tag.name, path: tag.path },
        tasks,
      })),
    };
  }

  /**
   * What the Flagged perspective shows: the tasks the user has flagged that the visibility shows (by default
   * only available ones), oldest first. A task is shown for its own flag only, never one above it.
   */
  async function flagged(visibility: Visibility = Visibility.available): Promise<FlaggedTask[]> {
    const now = clock();
    const rows = await sql<
      {
        id: string;
        title: string;
        note: string;
        projectId: string | null;
        projectName: string | null;
        completedAt: string | null;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        tagIds: string[];
        unfinishedChildren: number;
        deferredUntil: string | null;
        projectStatus: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", p.name AS "projectName", t.completed_at AS "completedAt",
             t.defer_until AS "deferUntil", t.due_at AS "dueAt", ARRAY(SELECT tt.tag_id::text FROM task_tags tt WHERE tt.task_id = t.id ORDER BY tt.tag_id) AS "tagIds",
             ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}, ${projectStatus(sql)}
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${sql.unsafe(flaggedCondition)} AND ${unfinishedUnless(sql, visibility)}
      ORDER BY t.created_at, t.id`;
    return rows
      .map(({ unfinishedChildren, deferredUntil, projectStatus, ...task }) => ({
        ...task,
        unavailable: unavailability({ completedAt: task.completedAt, unfinishedChildren, deferredUntil, projectStatus }, now),
      }))
      .filter((task) => shownUnder(visibility, task.unavailable));
  }

  /**
   * What the Projects perspective shows for a sidebar selection: each selected
   * project (every project inside a selected folder), in sidebar order, with
   * the tasks the visibility shows in outline order, each followed by its
   * prerequisites. A task whose parent is not shown is shown at the top level.
   */
  async function projects(selection: string[], visibility: Visibility = Visibility.remaining): Promise<ProjectOutline[]> {
    const selected = projectsInSelection(await organisation(), selection);
    if (selected.length === 0) return [];
    const now = clock();
    const ids = selected.map((p) => p.id);
    const dates = new Map(
      (await sql<{ id: string; deferUntil: string | null; dueAt: string | null }[]>`
        SELECT id, defer_until AS "deferUntil", due_at AS "dueAt" FROM projects WHERE id IN ${sql(ids)}`).map((p) => [p.id, p]),
    );
    const rows = await sql<
      {
        id: string;
        title: string;
        note: string;
        projectId: string;
        parentId: string | null;
        position: string | null;
        completedAt: string | null;
        deferUntil: string | null;
        dueAt: string | null;
        dueBy: string | null;
        flagged: boolean;
        unfinishedChildren: number;
        deferredUntil: string | null;
        projectStatus: string | null;
      }[]
    >`
      SELECT t.id, t.title, t.note, t.project_id AS "projectId", t.parent_id AS "parentId", t.position, t.completed_at AS "completedAt",
             t.defer_until AS "deferUntil", t.due_at AS "dueAt", t.flagged, ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}, ${projectStatus(sql)}
      FROM tasks t WHERE t.project_id IN ${sql(ids)} AND ${unfinishedUnless(sql, visibility)}`;
    const withAvailability = rows.map((row) => ({
      ...row,
      unavailable: unavailability(row, now),
    }));
    return selected.map((project) => ({
      project: {
        id: project.id,
        name: project.name,
        kind: project.kind,
        status: project.status,
        deferUntil: dates.get(project.id)?.deferUntil ?? null,
        dueAt: dates.get(project.id)?.dueAt ?? null,
      },
      tasks: pruneOutline(
        outlineTasks(withAvailability.filter((row) => row.projectId === project.id)),
        (row) => shownUnder(visibility, row.unavailable),
      ).map(({ task, depth, parentId }) => ({
        id: task.id,
        title: task.title,
        note: task.note,
        parentId,
        depth,
        completedAt: task.completedAt,
        deferUntil: task.deferUntil,
        dueAt: task.dueAt,
        dueBy: task.dueBy,
        flagged: task.flagged,
        unavailable: task.unavailable,
      })),
    }));
  }

  async function task(id: string): Promise<TaskView | null> {
    const [[row], tagRows, tree] = await Promise.all([
      sql`
        SELECT t.id, t.title, t.note, t.created_at, t.project_id, t.parent_id, t.completed_at, t.defer_until, t.due_at, t.flagged, c.id AS capture_id, c.text, c.captured_at,
               ${unfinishedChildren(sql)}, ${deferredUntil(sql)}, ${dueBy(sql)}, ${projectStatus(sql)}
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
      flagged: row.flagged,
      unavailable: unavailability(
        { completedAt: row.completed_at, unfinishedChildren: row.unfinishedChildren, deferredUntil: row.deferredUntil, projectStatus: row.projectStatus },
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

  return { execute, inbox, organisation, projects, tags, tagged, flagged, settings, actionable, task, history, operation };
}
