import { comparePositions } from './positions.ts';

// A task nested beneath another is one of its prerequisites. Siblings never
// wait on each other, whatever their order, and a child never waits on its
// parent. Children are always in their parent's project.

export interface NestedTask {
  id: string;
  parentId: string | null;
  position: string | null;
}

export interface OutlinedTask<T> {
  task: T;
  /** 1 for a top-level task, 2 for its children, and so on. */
  depth: number;
  /** The task this one is shown beneath, or null at the top level. */
  parentId: string | null;
}

/**
 * Tasks in outline order: each followed by its children, to any depth, in
 * sibling order. A task whose parent is not among them (completed, say) is
 * shown at the top level, and a cycle cannot hide a task.
 */
export function outlineTasks<T extends NestedTask>(tasks: readonly T[]): OutlinedTask<T>[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string | null, T[]>();
  for (const task of tasks) {
    const key = task.parentId !== null && ids.has(task.parentId) ? task.parentId : null;
    const siblings = children.get(key);
    if (siblings) siblings.push(task);
    else children.set(key, [task]);
  }
  const visited = new Set<string>();
  const out: OutlinedTask<T>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const task of [...(children.get(parentId) ?? [])].sort(comparePositions)) {
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      out.push({ task, depth, parentId });
      walk(task.id, depth + 1);
    }
  };
  walk(null, 1);
  for (const task of [...tasks].sort(comparePositions)) {
    if (visited.has(task.id)) continue;
    visited.add(task.id);
    out.push({ task, depth: 1, parentId: null });
    walk(task.id, 2);
  }
  return out;
}
