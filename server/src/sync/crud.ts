import { OperationName } from '@salamifocus/domain';

/** One row change from a PowerSync client's upload queue, as the clients send it. */
export interface CrudEntry {
  op: 'PUT' | 'PATCH' | 'DELETE';
  table: string;
  id: string;
  data?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
  metadata?: string | null;
}

export interface SubmittedOperation {
  opId: string;
  name: string;
  args: unknown;
  submitted: CrudEntry[];
  invalid?: { code: string; reason: string };
}

class Malformed extends Error {}

/**
 * Turns the row changes of one client transaction back into the logical
 * operations that produced them. Clients tag every row they write with the
 * operation's id and name, so the rows of one operation can be regrouped and
 * checked against the shape that operation is allowed to have.
 */
export function operationsFromCrud(entries: CrudEntry[]): SubmittedOperation[] {
  const groups: { opId: string | null; name: string | null; entries: CrudEntry[] }[] = [];
  for (const entry of entries) {
    const { opId, name } = readMetadata(entry.metadata);
    const last = groups.at(-1);
    if (last && opId !== null && last.opId === opId) last.entries.push(entry);
    else groups.push({ opId, name, entries: [entry] });
  }

  return groups.map(({ opId, name, entries: group }) => {
    const base = { opId: opId ?? `unidentified:${crypto.randomUUID()}`, name: name ?? 'unknown', submitted: group };
    if (opId === null || name === null) {
      return { ...base, args: null, invalid: { code: 'missing_metadata', reason: 'The change was not tagged with an operation.' } };
    }
    const translate = translators[name];
    if (!translate) return { ...base, args: null };
    try {
      return { ...base, args: translate(group) };
    } catch (error) {
      if (!(error instanceof Malformed)) throw error;
      return { ...base, args: null, invalid: { code: 'malformed_operation', reason: error.message } };
    }
  });
}

function readMetadata(metadata: string | null | undefined): { opId: string | null; name: string | null } {
  if (!metadata) return { opId: null, name: null };
  try {
    const parsed = JSON.parse(metadata);
    return {
      opId: typeof parsed?.op_id === 'string' && parsed.op_id !== '' ? parsed.op_id : null,
      name: typeof parsed?.op === 'string' ? parsed.op : null,
    };
  } catch {
    return { opId: null, name: null };
  }
}

function single(entries: CrudEntry[], op: CrudEntry['op'], table: string): CrudEntry {
  const matching = entries.filter((e) => e.op === op && e.table === table);
  if (matching.length !== 1) throw new Malformed(`Expected one ${op} on ${table}.`);
  return matching[0]!;
}

function onlyColumns(entry: CrudEntry, allowed: string[]): Record<string, unknown> {
  const data = entry.data ?? {};
  // An insert may list columns the operation does not set as null.
  const unexpected = Object.keys(data).filter((key) => !allowed.includes(key) && !(entry.op === 'PUT' && data[key] === null));
  if (unexpected.length > 0) throw new Malformed(`Unexpected change to ${unexpected.join(', ')} on ${entry.table}.`);
  return data;
}

/** The single row an operation inserts, limited to the columns it may set. */
function onlyInsert(entries: CrudEntry[], table: string, allowed: string[]): { id: string; data: Record<string, unknown> } {
  if (entries.length !== 1) throw new Malformed(`Expected a single insert into ${table}.`);
  const entry = single(entries, 'PUT', table);
  return { id: entry.id, data: onlyColumns(entry, allowed) };
}

/** The single row an operation updates, limited to the columns it may change, at least one of them changed. */
function onlyUpdate(entries: CrudEntry[], table: string, allowed: string[]): { id: string; data: Record<string, unknown> } {
  if (entries.length !== 1) throw new Malformed(`Expected a single update to ${table}.`);
  const entry = single(entries, 'PATCH', table);
  const data = onlyColumns(entry, allowed);
  if (!allowed.some((column) => column in data)) throw new Malformed(`Expected a change to ${allowed.join(' or ')}.`);
  return { id: entry.id, data };
}

/** A column's new value, or undefined when the update leaves it alone. */
const changed = (data: Record<string, unknown>, column: string) => (column in data ? data[column] : undefined);

const translators: Record<string, (entries: CrudEntry[]) => unknown> = {
  [OperationName.captureText](entries) {
    if (entries.length !== 2) throw new Malformed('A capture writes exactly one task and one capture.');
    const task = single(entries, 'PUT', 'tasks');
    const capture = single(entries, 'PUT', 'captures');
    onlyColumns(task, ['title', 'created_at']);
    const data = onlyColumns(capture, ['task_id', 'text', 'captured_at']);
    if (data.task_id !== task.id) throw new Malformed('The capture does not belong to the task it created.');
    return { taskId: task.id, captureId: capture.id, text: data.text, capturedAt: data.captured_at };
  },

  [OperationName.renameTask](entries) {
    if (entries.length !== 1) throw new Malformed('A rename changes exactly one task.');
    const task = single(entries, 'PATCH', 'tasks');
    const data = onlyColumns(task, ['title']);
    if (!('title' in data)) throw new Malformed('A rename must change the title.');
    return { taskId: task.id, title: data.title };
  },

  [OperationName.createTask](entries) {
    // The task's row, then a link row for each tag it starts with.
    const task = single(entries, 'PUT', 'tasks');
    const data = onlyColumns(task, ['title', 'project_id', 'parent_id', 'position', 'created_at']);
    const links = entries.filter((entry) => entry !== task);
    const tags = links.map((link) => {
      if (link.op !== 'PUT' || link.table !== 'task_tags') throw new Malformed('A new task writes only its own row and its tags.');
      const tag = onlyColumns(link, ['task_id', 'tag_id']);
      if (tag.task_id !== task.id) throw new Malformed('A tag does not belong to the task it was added with.');
      return { taskTagId: link.id, tagId: tag.tag_id };
    });
    return {
      taskId: task.id,
      projectId: data.project_id ?? null,
      parentId: data.parent_id ?? null,
      title: data.title,
      position: data.position ?? null,
      createdAt: data.created_at,
      tags,
    };
  },

  [OperationName.editTaskNote](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['note']);
    return { taskId: id, note: data.note ?? '' };
  },

  [OperationName.completeTask](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['completed_at']);
    if (typeof data.completed_at !== 'string') throw new Malformed('A completion must set when the task was completed.');
    return { taskId: id, completedAt: data.completed_at };
  },

  [OperationName.deferTask](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['defer_until']);
    return { taskId: id, deferUntil: data.defer_until ?? null };
  },

  [OperationName.setTaskDue](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['due_at']);
    return { taskId: id, dueAt: data.due_at ?? null };
  },

  [OperationName.reorderTask](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['position']);
    return { taskId: id, position: data.position };
  },

  [OperationName.moveTask](entries) {
    // The moved task comes first; then the client's own copy of its children following it, which the
    // server works out for itself.
    const [move, ...children] = entries;
    const { id, data } = onlyUpdate(move ? [move] : [], 'tasks', ['project_id', 'parent_id', 'position']);
    // Clients send only the columns that changed, so the position is absent when it stays the same.
    if (!('project_id' in data)) throw new Malformed('A move must change the project.');
    if ((data.parent_id ?? null) !== null) throw new Malformed('A moved task leaves its parent.');
    for (const child of children) {
      if (child.op !== 'PATCH' || child.table !== 'tasks' || onlyColumns(child, ['project_id']).project_id !== data.project_id) {
        throw new Malformed('A move changes only the project of the moved task’s children.');
      }
    }
    return { taskId: id, projectId: data.project_id ?? null, position: changed(data, 'position') };
  },

  [OperationName.nestTask](entries) {
    const { id, data } = onlyUpdate(entries, 'tasks', ['parent_id', 'position']);
    return { taskId: id, parentId: changed(data, 'parent_id'), position: changed(data, 'position') };
  },

  [OperationName.createFolder](entries) {
    const { id, data } = onlyInsert(entries, 'folders', ['name', 'parent_id', 'position']);
    return { folderId: id, name: data.name, parentId: data.parent_id ?? null, position: data.position };
  },

  [OperationName.renameFolder](entries) {
    const { id, data } = onlyUpdate(entries, 'folders', ['name']);
    return { folderId: id, name: data.name };
  },

  [OperationName.moveFolder](entries) {
    const { id, data } = onlyUpdate(entries, 'folders', ['parent_id', 'position']);
    return { folderId: id, parentId: changed(data, 'parent_id'), position: changed(data, 'position') };
  },

  [OperationName.createProject](entries) {
    const { id, data } = onlyInsert(entries, 'projects', ['name', 'kind', 'folder_id', 'position']);
    return { projectId: id, name: data.name, kind: data.kind, folderId: data.folder_id ?? null, position: data.position };
  },

  [OperationName.renameProject](entries) {
    const { id, data } = onlyUpdate(entries, 'projects', ['name']);
    return { projectId: id, name: data.name };
  },

  [OperationName.moveProject](entries) {
    const { id, data } = onlyUpdate(entries, 'projects', ['folder_id', 'position']);
    return { projectId: id, folderId: changed(data, 'folder_id'), position: changed(data, 'position') };
  },

  [OperationName.deferProject](entries) {
    const { id, data } = onlyUpdate(entries, 'projects', ['defer_until']);
    return { projectId: id, deferUntil: data.defer_until ?? null };
  },

  [OperationName.setProjectDue](entries) {
    const { id, data } = onlyUpdate(entries, 'projects', ['due_at']);
    return { projectId: id, dueAt: data.due_at ?? null };
  },

  [OperationName.createTag](entries) {
    const { id, data } = onlyInsert(entries, 'tags', ['name', 'parent_id', 'position']);
    return { tagId: id, name: data.name, parentId: data.parent_id ?? null, position: data.position };
  },

  [OperationName.renameTag](entries) {
    const { id, data } = onlyUpdate(entries, 'tags', ['name']);
    return { tagId: id, name: data.name };
  },

  [OperationName.moveTag](entries) {
    const { id, data } = onlyUpdate(entries, 'tags', ['parent_id', 'position']);
    return { tagId: id, parentId: changed(data, 'parent_id'), position: changed(data, 'position') };
  },

  [OperationName.tagTask](entries) {
    const { id, data } = onlyInsert(entries, 'task_tags', ['task_id', 'tag_id']);
    return { taskTagId: id, taskId: data.task_id, tagId: data.tag_id };
  },

  [OperationName.untagTask](entries) {
    // A delete carries no data, but the client sends the link's previous values, which say which tag left which task.
    const pairs = new Set(
      entries.map((entry) => {
        if (entry.op !== 'DELETE' || entry.table !== 'task_tags') throw new Malformed('Removing a tag only deletes links.');
        const { task_id: taskId, tag_id: tagId } = entry.old ?? {};
        if (typeof taskId !== 'string' || typeof tagId !== 'string') throw new Malformed('A removed link must say which task and tag it joined.');
        return JSON.stringify({ taskId, tagId });
      }),
    );
    if (pairs.size !== 1) throw new Malformed('Removing a tag takes one tag off one task.');
    return JSON.parse([...pairs][0]!);
  },
};
