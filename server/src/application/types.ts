import type { Unavailable } from '@salamifocus/domain';

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
  /** The task this one is a prerequisite of. */
  parentId: string | null;
  completedAt: string | null;
  /** When the task itself is deferred until, or null. Tasks it is beneath can defer it too (see `unavailable`). */
  deferUntil: string | null;
  /** Why the task cannot be worked on now; empty when it is available. */
  unavailable: Unavailable[];
  /** In sidebar order, each with its full path. */
  tags: TagView[];
  capture: { id: string; text: string; capturedAt: string } | null;
}

export interface TagView {
  id: string;
  name: string;
  path: string[];
}

export interface TagOutline {
  tag: TagView;
  tasks: { id: string; title: string; note: string; projectId: string | null; deferUntil: string | null; tagIds: string[]; unavailable: Unavailable[] }[];
}

export interface ProjectOutline {
  project: { id: string; name: string; kind: string };
  /** In outline order, each followed by its children. `parentId` is the task it is shown beneath (null at the top level). */
  tasks: { id: string; title: string; note: string; parentId: string | null; depth: number; deferUntil: string | null; unavailable: Unavailable[] }[];
}

export interface ChangeView {
  entity: string;
  entityId: string;
  kind: 'create' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
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
