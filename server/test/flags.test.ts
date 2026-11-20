import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OperationName } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function project(name: string) {
  const projectId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createProject, { projectId, name, kind: 'project', folderId: null, position: 'a0' }), 'applied');
  return projectId;
}

async function addTask(projectId: string, title: string, parentId: string | null = null) {
  const taskId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTask, { taskId, projectId, parentId, title, position: 'a0', createdAt: '2026-11-13T10:00:00.000Z' }), 'applied');
  return taskId;
}

const flag = (taskId: string) => perform(OperationName.flagTask, { taskId });
const unflag = (taskId: string) => perform(OperationName.unflagTask, { taskId });
const flagged = async (taskId: string) => (await h.application.task(taskId))?.flagged;

describe('flags', () => {
  it('flags and unflags a task, keeping each change in its history', async () => {
    const id = await project('Quarterly report');
    const task = await addTask(id, 'Compile the report');
    assert.equal(await flagged(task), false);

    assert.equal(await flag(task), 'applied');
    assert.equal(await flagged(task), true);
    // Flagged on two devices: still flagged, with nothing more to record.
    assert.equal(await flag(task), 'applied');
    assert.equal(await unflag(task), 'applied');
    assert.equal(await flagged(task), false);

    const changes = (await h.application.history(task)).filter((e) => e.operation === OperationName.flagTask || e.operation === OperationName.unflagTask);
    assert.deepEqual(
      changes.map((e) => e.changes[0]?.after),
      [{ flagged: true }, { flagged: false }],
    );
    assert.equal(await flag(crypto.randomUUID()), 'not_found');
  });

  it('keeps a flag while the task is deferred or blocked, and never gives it to the tasks beneath', async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Quarterly report');
    const compile = await addTask(id, 'Compile the report');
    assert.equal(await flag(compile), 'applied');
    assert.equal(await perform(OperationName.deferTask, { taskId: compile, deferUntil: '2026-11-30T00:00:00.000Z' }), 'applied');
    const email = await addTask(id, 'Email Steve to request the document', compile);

    const task = await h.application.task(compile);
    assert.deepEqual([task?.flagged, task?.unavailable], [true, ['blocked', 'deferred']]);
    assert.equal(await flagged(email), false);
    const [outline] = await h.application.projects([id]);
    assert.deepEqual(
      outline?.tasks.map((t) => [t.title, t.flagged]),
      [
        ['Compile the report', true],
        ['Email Steve to request the document', false],
      ],
    );
  });
});
