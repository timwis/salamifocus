// Names of the logical operations a client can perform. Every local write is
// tagged with one of these and a fresh operation id, which the server uses to
// apply the change exactly once and to attribute it in history.
export const OperationName = {
  captureText: 'capture_text',
  renameTask: 'rename_task',
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
