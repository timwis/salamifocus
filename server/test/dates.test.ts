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

const defer = (taskId: string, deferUntil: string | null) => perform(OperationName.deferTask, { taskId, deferUntil });
const unavailable = async (taskId: string) => (await h.application.task(taskId))?.unavailable;

describe('defer and due dates', () => {
  it('keeps a deferred prerequisite blocking its parent, and makes it available when its date arrives', async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Quarterly report');
    const compile = await addTask(id, 'Compile the report');
    const email = await addTask(id, 'Email Steve to request the document', compile);

    assert.equal(await defer(email, '2026-11-23T00:00:00.000Z'), 'applied');
    assert.deepEqual(await unavailable(email), ['deferred']);
    assert.deepEqual(await unavailable(compile), ['blocked']);
    assert.equal((await h.application.task(email))?.deferUntil, '2026-11-23T00:00:00.000Z');
    // Projects shows remaining tasks, deferred ones included.
    assert.deepEqual(
      (await h.application.projects([id]))[0]?.tasks.map((t) => [t.title, t.unavailable]),
      [['Compile the report', ['blocked']], ['Email Steve to request the document', ['deferred']]],
    );

    h.clock.set(new Date('2026-11-23T00:00:00.000Z'));
    assert.deepEqual(await unavailable(email), []);
    assert.deepEqual(await unavailable(compile), ['blocked']);

    assert.equal(await perform(OperationName.completeTask, { taskId: email, completedAt: '2026-11-23T10:00:00.000Z' }), 'applied');
    assert.deepEqual(await unavailable(compile), []);
  });

  it('defers the tasks beneath a deferred task with it', async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Garden');
    const plant = await addTask(id, 'Plant the bulbs');
    const buy = await addTask(id, 'Buy bulbs', plant);
    const choose = await addTask(id, 'Choose the colours', buy);

    assert.equal(await defer(plant, '2026-12-01T00:00:00.000Z'), 'applied');
    assert.equal(await defer(buy, '2026-11-20T00:00:00.000Z'), 'applied');
    assert.deepEqual(await unavailable(choose), ['deferred']);

    // The latest defer date above a task holds it back.
    h.clock.set(new Date('2026-11-25T00:00:00.000Z'));
    assert.deepEqual(await unavailable(buy), ['blocked', 'deferred']);
    assert.deepEqual(await unavailable(choose), ['deferred']);
    h.clock.set(new Date('2026-12-01T00:00:00.000Z'));
    assert.deepEqual(await unavailable(choose), []);
  });

  it('clears a defer date, records the change and refuses one it cannot read', async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Paperwork');
    const task = await addTask(id, 'Chase the insurer');

    assert.equal(await defer(task, '2026-11-30T00:00:00Z'), 'applied');
    assert.equal(await defer(task, null), 'applied');
    assert.deepEqual(await unavailable(task), []);
    assert.equal(await defer(task, 'next tuesday'), 'invalid_arguments');
    // Only a full time with its zone names one moment.
    for (const loose of ['1', '2026-11-30', '2026-11-30 09:00', '2026-11-30T09:00:00']) {
      assert.equal(await defer(task, loose), 'invalid_arguments', loose);
    }
    assert.equal(await defer(task, '2026-11-30T09:00:00+01:00'), 'applied');
    assert.equal((await h.application.task(task))?.deferUntil, '2026-11-30T08:00:00.000Z');
    assert.equal(await defer(task, null), 'applied');
    assert.equal(await defer(crypto.randomUUID(), null), 'not_found');

    const history = await h.application.history(task);
    assert.deepEqual(
      history.filter((e) => e.operation === OperationName.deferTask).map((e) => e.changes[0]?.after),
      [{ defer_until: '2026-11-30T00:00:00.000Z' }, { defer_until: null }, { defer_until: '2026-11-30T08:00:00.000Z' }, { defer_until: null }],
    );
  });

  it('keeps a due date separate from deferral: it never changes availability, and tasks beneath are due by it too', async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Tax return');
    const file = await addTask(id, 'File the return');
    const gather = await addTask(id, 'Gather the receipts', file);
    const due = (taskId: string, dueAt: string | null) => perform(OperationName.setTaskDue, { taskId, dueAt });

    assert.equal(await due(file, '2026-11-20T17:00:00.000Z'), 'applied');
    assert.equal(await due(gather, '2026-11-25T17:00:00.000Z'), 'applied');
    assert.equal(await defer(gather, '2026-11-18T00:00:00.000Z'), 'applied');
    const task = await h.application.task(gather);
    assert.deepEqual([task?.dueAt, task?.dueBy, task?.deferUntil], ['2026-11-25T17:00:00.000Z', '2026-11-20T17:00:00.000Z', '2026-11-18T00:00:00.000Z']);

    // Past its due date, a task is still only as unavailable as it was.
    h.clock.set(new Date('2026-11-30T09:00:00.000Z'));
    assert.deepEqual(await unavailable(gather), []);
    assert.deepEqual(await unavailable(file), ['blocked']);

    assert.equal(await due(gather, null), 'applied');
    assert.equal((await h.application.task(gather))?.dueAt, null);
    assert.equal((await h.application.task(gather))?.deferUntil, '2026-11-18T00:00:00.000Z');
    assert.equal(await due(gather, 'friday'), 'invalid_arguments');
  });

  it("defers a project's tasks with it and makes them due by its due date, a task's own dates still counting", async () => {
    h.clock.set(new Date('2026-11-16T09:00:00.000Z'));
    const id = await project('Conference');
    const book = await addTask(id, 'Book the venue');
    const call = await addTask(id, 'Call the caterer', book);
    const deferProject = (deferUntil: string | null) => perform(OperationName.deferProject, { projectId: id, deferUntil });
    const projectDue = (dueAt: string | null) => perform(OperationName.setProjectDue, { projectId: id, dueAt });

    assert.equal(await deferProject('2026-11-20T00:00:00.000Z'), 'applied');
    assert.equal(await defer(call, '2026-11-25T00:00:00.000Z'), 'applied');
    assert.deepEqual(await unavailable(book), ['blocked', 'deferred']);
    assert.equal((await h.application.projects([id]))[0]?.project.deferUntil, '2026-11-20T00:00:00.000Z');

    h.clock.set(new Date('2026-11-21T09:00:00.000Z'));
    assert.deepEqual(await unavailable(book), ['blocked']);
    assert.deepEqual(await unavailable(call), ['deferred']);

    assert.equal(await perform(OperationName.setTaskDue, { taskId: call, dueAt: '2026-12-05T17:00:00.000Z' }), 'applied');
    assert.equal(await projectDue('2026-12-01T17:00:00.000Z'), 'applied');
    assert.deepEqual(
      [(await h.application.task(book))?.dueBy, (await h.application.task(call))?.dueBy],
      ['2026-12-01T17:00:00.000Z', '2026-12-01T17:00:00.000Z'],
    );
    assert.equal(await projectDue(null), 'applied');
    assert.equal((await h.application.task(call))?.dueBy, '2026-12-05T17:00:00.000Z');

    assert.equal(await deferProject('soon'), 'invalid_arguments');
    assert.equal(await perform(OperationName.deferProject, { projectId: crypto.randomUUID(), deferUntil: null }), 'not_found');
  });
});
