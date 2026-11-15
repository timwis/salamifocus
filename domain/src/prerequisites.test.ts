import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outlineTasks, type NestedTask } from './prerequisites.ts';

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
