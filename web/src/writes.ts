import { operationMetadata, OperationName, positionBetween, ProjectKind, titleFromCapture } from '@salamifocus/domain';
import type { Transaction } from '@powersync/web';
import { db } from './powersync.ts';

// Every local write is a logical operation: its rows are written in one
// transaction, each tagged with the operation, and uploaded when online. A
// transaction can hold more than one operation when they belong together,
// such as creating a project and moving a task into it.

async function write(op: OperationName, sql: string, params: (metadata: string) => unknown[]): Promise<void> {
  const metadata = operationMetadata(op);
  await db.writeTransaction((tx) => tx.execute(sql, params(metadata)));
}

/** Saves text as a new Inbox task, keeping the text exactly as typed as its original capture. */
export async function captureText(text: string): Promise<string> {
  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const metadata = operationMetadata(OperationName.captureText);
  await db.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO tasks (id, title, created_at, _metadata) VALUES (?, ?, ?, ?)', [taskId, titleFromCapture(text), now, metadata]);
    await tx.execute('INSERT INTO captures (id, task_id, text, captured_at, _metadata) VALUES (?, ?, ?, ?, ?)', [
      crypto.randomUUID(),
      taskId,
      text,
      now,
      metadata,
    ]);
  });
  return taskId;
}

export function renameTask(taskId: string, title: string) {
  return write(OperationName.renameTask, 'UPDATE tasks SET title = ?, _metadata = ? WHERE id = ?', (m) => [title, m, taskId]);
}

export function editTaskNote(taskId: string, note: string) {
  return write(OperationName.editTaskNote, 'UPDATE tasks SET note = ?, _metadata = ? WHERE id = ?', (m) => [note, m, taskId]);
}

export function completeTask(taskId: string) {
  return write(OperationName.completeTask, 'UPDATE tasks SET completed_at = ?, _metadata = ? WHERE id = ?', (m) => [
    new Date().toISOString(),
    m,
    taskId,
  ]);
}

/** Defers a task (and the tasks beneath it) until a time, or with null stops deferring it. */
export function deferTask(taskId: string, deferUntil: string | null) {
  return write(OperationName.deferTask, 'UPDATE tasks SET defer_until = ?, _metadata = ? WHERE id = ?', (m) => [deferUntil, m, taskId]);
}

/** Sets a task's due date, or with null clears it. */
export function setTaskDue(taskId: string, dueAt: string | null) {
  return write(OperationName.setTaskDue, 'UPDATE tasks SET due_at = ?, _metadata = ? WHERE id = ?', (m) => [dueAt, m, taskId]);
}

export function reorderTask(taskId: string, position: string) {
  return write(OperationName.reorderTask, 'UPDATE tasks SET position = ?, _metadata = ? WHERE id = ?', (m) => [position, m, taskId]);
}

/**
 * Puts a task at the end of a project or single-action list, or (with null) takes it out of any. It leaves
 * its parent, and its own children, to any depth, go with it.
 */
export function moveTask(taskId: string, projectId: string | null) {
  return db.writeTransaction((tx) => moveTaskIn(tx, taskId, projectId, operationMetadata(OperationName.moveTask)));
}

async function moveTaskIn(tx: Transaction, taskId: string, projectId: string | null, metadata: string) {
  let position: string | null = null;
  if (projectId !== null) {
    const { last } = await tx.get<{ last: string | null }>('SELECT max(position) AS last FROM tasks WHERE project_id = ? AND id != ?', [projectId, taskId]);
    position = positionBetween(last, null);
  }
  await tx.execute('UPDATE tasks SET project_id = ?, parent_id = NULL, position = ?, _metadata = ? WHERE id = ?', [projectId, position, metadata, taskId]);
  const descendants = await tx.getAll<{ id: string }>(
    `WITH RECURSIVE beneath(id) AS (SELECT id FROM tasks WHERE parent_id = ? UNION SELECT t.id FROM tasks t JOIN beneath b ON t.parent_id = b.id)
     SELECT id FROM beneath WHERE id != ?`,
    [taskId, taskId],
  );
  for (const { id } of descendants) {
    await tx.execute('UPDATE tasks SET project_id = ?, _metadata = ? WHERE id = ?', [projectId, metadata, id]);
  }
}

/**
 * Creates a project at the end of a folder (or the top level) and puts a task in it. They are two
 * operations, written together so neither is seen without the other.
 */
export function createProjectForTask(taskId: string, project: { id: string; name: string; folderId: string | null }) {
  return db.writeTransaction(async (tx) => {
    const { last } = await tx.get<{ last: string | null }>(
      'SELECT max(position) AS last FROM (SELECT position FROM folders WHERE parent_id IS ? UNION ALL SELECT position FROM projects WHERE folder_id IS ?)',
      [project.folderId, project.folderId],
    );
    await tx.execute('INSERT INTO projects (id, name, kind, folder_id, position, _metadata) VALUES (?, ?, ?, ?, ?, ?)', [
      project.id,
      project.name,
      ProjectKind.project,
      project.folderId,
      positionBetween(last, null),
      operationMetadata(OperationName.createProject),
    ]);
    await moveTaskIn(tx, taskId, project.id, operationMetadata(OperationName.moveTask));
  });
}

/** Puts a task beneath another in its project (or, with no parent, back at the top level); its children go with it. */
export function nestTask(taskId: string, parentId: string | null, position: string) {
  return write(OperationName.nestTask, 'UPDATE tasks SET parent_id = ?, position = ?, _metadata = ? WHERE id = ?', (m) => [
    parentId,
    position,
    m,
    taskId,
  ]);
}

/**
 * Adds a task, in a project at a position (beneath a parent task, if given) or, with no project, in the Inbox,
 * with any tags, as one operation.
 */
export async function createTask(
  taskId: string,
  projectId: string | null,
  title: string,
  position: string | null,
  tagIds: readonly string[] = [],
  parentId: string | null = null,
) {
  const metadata = operationMetadata(OperationName.createTask);
  await db.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO tasks (id, title, project_id, parent_id, position, created_at, _metadata) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      taskId,
      title,
      projectId,
      parentId,
      position,
      new Date().toISOString(),
      metadata,
    ]);
    for (const tagId of tagIds) {
      await tx.execute('INSERT INTO task_tags (id, task_id, tag_id, _metadata) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), taskId, tagId, metadata]);
    }
  });
}

export function createFolder(folderId: string, name: string, parentId: string | null, position: string) {
  return write(
    OperationName.createFolder,
    'INSERT INTO folders (id, name, parent_id, position, _metadata) VALUES (?, ?, ?, ?, ?)',
    (m) => [folderId, name, parentId, position, m],
  );
}

export function renameFolder(folderId: string, name: string) {
  return write(OperationName.renameFolder, 'UPDATE folders SET name = ?, _metadata = ? WHERE id = ?', (m) => [name, m, folderId]);
}

export function moveFolder(folderId: string, parentId: string | null, position: string) {
  return write(
    OperationName.moveFolder,
    'UPDATE folders SET parent_id = ?, position = ?, _metadata = ? WHERE id = ?',
    (m) => [parentId, position, m, folderId],
  );
}

export function createProject(projectId: string, name: string, kind: ProjectKind, folderId: string | null, position: string) {
  return write(
    OperationName.createProject,
    'INSERT INTO projects (id, name, kind, folder_id, position, _metadata) VALUES (?, ?, ?, ?, ?, ?)',
    (m) => [projectId, name, kind, folderId, position, m],
  );
}

export function renameProject(projectId: string, name: string) {
  return write(OperationName.renameProject, 'UPDATE projects SET name = ?, _metadata = ? WHERE id = ?', (m) => [name, m, projectId]);
}

export function moveProject(projectId: string, folderId: string | null, position: string) {
  return write(
    OperationName.moveProject,
    'UPDATE projects SET folder_id = ?, position = ?, _metadata = ? WHERE id = ?',
    (m) => [folderId, position, m, projectId],
  );
}

export function createTag(tagId: string, name: string, parentId: string | null, position: string) {
  return write(OperationName.createTag, 'INSERT INTO tags (id, name, parent_id, position, _metadata) VALUES (?, ?, ?, ?, ?)', (m) => [
    tagId,
    name,
    parentId,
    position,
    m,
  ]);
}

export function renameTag(tagId: string, name: string) {
  return write(OperationName.renameTag, 'UPDATE tags SET name = ?, _metadata = ? WHERE id = ?', (m) => [name, m, tagId]);
}

export function moveTag(tagId: string, parentId: string | null, position: string) {
  return write(OperationName.moveTag, 'UPDATE tags SET parent_id = ?, position = ?, _metadata = ? WHERE id = ?', (m) => [
    parentId,
    position,
    m,
    tagId,
  ]);
}

export function tagTask(taskId: string, tagId: string) {
  return write(OperationName.tagTask, 'INSERT INTO task_tags (id, task_id, tag_id, _metadata) VALUES (?, ?, ?, ?)', (m) => [
    crypto.randomUUID(),
    taskId,
    tagId,
    m,
  ]);
}

/** Deleting through _deleted lets the delete carry its operation, which a plain DELETE cannot. */
export function untagTask(taskId: string, tagId: string) {
  return write(OperationName.untagTask, 'UPDATE task_tags SET _deleted = TRUE, _metadata = ? WHERE task_id = ? AND tag_id = ?', (m) => [
    m,
    taskId,
    tagId,
  ]);
}
