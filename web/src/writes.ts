import { operationMetadata, OperationName, type ProjectKind } from '@salamifocus/domain';
import { db } from './powersync.ts';

// Every local write is one logical operation: its rows are written in one
// transaction, each tagged with the operation, and uploaded when online.

async function write(op: OperationName, sql: string, params: (metadata: string) => unknown[]): Promise<void> {
  const metadata = operationMetadata(op);
  await db.writeTransaction((tx) => tx.execute(sql, params(metadata)));
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

export function reorderTask(taskId: string, position: string) {
  return write(OperationName.reorderTask, 'UPDATE tasks SET position = ?, _metadata = ? WHERE id = ?', (m) => [position, m, taskId]);
}

/** Adds a task, in a project at a position or (with no project) in the Inbox, with any tags, as one operation. */
export async function createTask(taskId: string, projectId: string | null, title: string, position: string | null, tagIds: readonly string[] = []) {
  const metadata = operationMetadata(OperationName.createTask);
  await db.writeTransaction(async (tx) => {
    await tx.execute('INSERT INTO tasks (id, title, project_id, position, created_at, _metadata) VALUES (?, ?, ?, ?, ?, ?)', [
      taskId,
      title,
      projectId,
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
