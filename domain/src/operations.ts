// Names of the logical operations a client can perform. Every local write is
// tagged with one of these and a fresh operation id, which the server uses to
// apply the change exactly once and to attribute it in history.
export const OperationName = {
  captureText: 'capture_text',
  renameTask: 'rename_task',
  createTask: 'create_task',
  editTaskNote: 'edit_task_note',
  completeTask: 'complete_task',
  reopenTask: 'reopen_task',
  deferTask: 'defer_task',
  setTaskDue: 'set_task_due',
  flagTask: 'flag_task',
  unflagTask: 'unflag_task',
  reorderTask: 'reorder_task',
  moveTask: 'move_task',
  nestTask: 'nest_task',
  createFolder: 'create_folder',
  renameFolder: 'rename_folder',
  moveFolder: 'move_folder',
  createProject: 'create_project',
  renameProject: 'rename_project',
  moveProject: 'move_project',
  deferProject: 'defer_project',
  setProjectDue: 'set_project_due',
  pauseProject: 'pause_project',
  resumeProject: 'resume_project',
  createTag: 'create_tag',
  renameTag: 'rename_tag',
  moveTag: 'move_tag',
  tagTask: 'tag_task',
  untagTask: 'untag_task',
} as const;

export type OperationName = (typeof OperationName)[keyof typeof OperationName];

export interface OperationMetadata {
  op_id: string;
  op: OperationName;
}

export function operationMetadata(op: OperationName, opId: string = crypto.randomUUID()): string {
  const metadata: OperationMetadata = { op_id: opId, op };
  return JSON.stringify(metadata);
}
