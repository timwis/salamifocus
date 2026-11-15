import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unavailability } from './availability.ts';
import { outlineTasks, pruneOutline, type NestedTask } from './prerequisites.ts';

const task = (id: string, parentId: string | null, position: string): NestedTask => ({ id, parentId, position });
const rows = (tasks: NestedTask[]) => outlineTasks(tasks).map(({ task, depth }) => `${'  '.repeat(depth - 1)}${task.id}`);

test('children follow their parent, to any depth, each level in sibling order', () => {
  assert.deepEqual(
    rows([task('b', null, 'a1'), task('a', null, 'a0'), task('a2', 'a', 'a1'), task('a1', 'a', 'a0'), task('a1x', 'a1', 'a0')]),
    ['a', '  a1', '    a1x', '  a2', 'b'],
  );
});

test('a task whose parent is not shown, or that is caught in a cycle, is still shown', () => {
  assert.deepEqual(rows([task('x', 'y', 'a1'), task('y', 'x', 'a2'), task('orphan', 'completed', 'a0')]), ['orphan', 'x', '  y']);
});

test('a pruned outline keeps its order, with each task beneath its nearest kept ancestor', () => {
  const outlined = outlineTasks([task('a', null, 'a0'), task('a1', 'a', 'a0'), task('a1x', 'a1', 'a0'), task('a2', 'a', 'a1'), task('b', null, 'a1')]);
  const kept = pruneOutline(outlined, (t) => t.id !== 'a1');
  assert.deepEqual(
    kept.map(({ task, depth, parentId }) => [task.id, depth, parentId]),
    [['a', 1, null], ['a1x', 2, 'a'], ['a2', 2, 'a'], ['b', 1, null]],
  );
  assert.deepEqual(
    pruneOutline(outlined, (t) => t.id !== 'a').map(({ task, depth }) => `${'  '.repeat(depth - 1)}${task.id}`),
    ['a1', '  a1x', 'a2', 'b'],
  );
});

const now = new Date('2026-11-16T09:00:00.000Z');

test('a task waits only on its own unfinished children', () => {
  assert.deepEqual(unavailability({ completedAt: null, unfinishedChildren: 1, deferredUntil: null }, now), ['blocked']);
  assert.deepEqual(unavailability({ completedAt: null, unfinishedChildren: 0, deferredUntil: null }, now), []);
  assert.deepEqual(unavailability({ completedAt: '2026-11-13T09:00:00.000Z', unfinishedChildren: 1, deferredUntil: null }, now), ['completed']);
});

test('a deferred task is unavailable until the clock reaches its defer date', () => {
  const task = (deferredUntil: string) => ({ completedAt: null, unfinishedChildren: 1, deferredUntil });
  assert.deepEqual(unavailability(task('2026-11-16T09:00:00.001Z'), now), ['blocked', 'deferred']);
  assert.deepEqual(unavailability(task('2026-11-16T09:00:00.000Z'), now), ['blocked']);
  // As PowerSync syncs timestamps, with microseconds.
  assert.deepEqual(unavailability(task('2026-11-23T00:00:00.000000Z'), now), ['blocked', 'deferred']);
});
