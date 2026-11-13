export interface Actor {
  type: 'user';
  id: string;
}

export interface OperationRequest {
  opId: string;
  name: string;
  args: unknown;
  actor: Actor;
  sessionId?: string | null;
  /** The kind of client the operation came through, for example "android". */
  source?: string | null;
  /** The raw submission to keep alongside the outcome. Defaults to `args`. */
  submitted?: unknown;
  /** Set by an adapter that already knows the submission cannot be applied. */
  invalid?: { code: string; reason: string };
}

export type OperationResult =
  | { opId: string; outcome: 'applied'; duplicate: boolean }
  | { opId: string; outcome: 'rejected'; code: string; reason: string; duplicate: boolean };

export interface InboxEntry {
  id: string;
  title: string;
  createdAt: string;
}

export interface TaskView {
  id: string;
  title: string;
  note: string;
  createdAt: string;
  projectId: string | null;
  capture: { id: string; text: string; capturedAt: string } | null;
}

export interface ProjectOutline {
  project: { id: string; name: string; kind: string };
  tasks: { id: string; title: string; note: string }[];
}

export interface ChangeView {
  entity: string;
  entityId: string;
  kind: 'create' | 'update';
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

export interface HistoryEntry {
  opId: string;
  operation: string;
  actor: Actor;
  source: string | null;
  recordedAt: string;
  changes: ChangeView[];
}

export interface OperationRecord {
  opId: string;
  operation: string;
  actor: Actor;
  source: string | null;
  outcome: 'applied' | 'rejected';
  rejectionCode: string | null;
  rejectionReason: string | null;
  submitted: unknown;
  deliveries: number;
  recordedAt: string;
}
