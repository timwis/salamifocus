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
