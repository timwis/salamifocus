import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OperationName } from '@salamifocus/domain';
import { createHarness, owner, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function folder(name: string, parentId: string | null = null) {
  const folderId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createFolder, { folderId, name, parentId, position: 'a0' }), 'applied');
  return folderId;
}

async function project(name: string, options: { folderId?: string; kind?: string; position?: string } = {}) {
  const projectId = crypto.randomUUID();
  const { folderId = null, kind = 'project', position = 'a0' } = options;
  assert.equal(await perform(OperationName.createProject, { projectId, name, kind, folderId, position }), 'applied');
  return projectId;
}

async function addTask(projectId: string, title: string, position: string) {
  const taskId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTask, { taskId, projectId, title, position, createdAt: '2026-11-13T10:00:00.000Z' }), 'applied');
  return taskId;
}

const outline = async (selection: string[]) =>
  (await h.application.projects(selection)).map(({ project, tasks }) => ({ [project.name]: tasks.map((t) => t.title) }));

describe('tasks in projects', () => {
  it('lists a project’s tasks in their outline order, whatever order they were added in', async () => {
    const id = await project('Kitchen redecorated');
    await addTask(id, 'Paint the ceiling', 'a2');
    await addTask(id, 'Choose a colour', 'a0');
    await addTask(id, '  Buy dust sheets ', 'a1');

    assert.deepEqual(await outline([id]), [{ 'Kitchen redecorated': ['Choose a colour', 'Buy dust sheets', 'Paint the ceiling'] }]);
  });

  it('holds standalone tasks in a single-action list', async () => {
    const id = await project('Miscellaneous', { kind: 'single_actions' });
    await addTask(id, 'Return library books', 'a0');
    await addTask(id, 'Descale the kettle', 'a1');

    const [list] = await h.application.projects([id]);
    assert.equal(list?.project.kind, 'single_actions');
    assert.deepEqual(list?.tasks.map((t) => t.title), ['Return library books', 'Descale the kettle']);
  });

  it('shows every project inside a selected folder, in sidebar order, including empty ones', async () => {
    const home = await folder('Home');
    const loft = await folder('Loft', home);
    const boiler = await project('Boiler serviced', { folderId: home, position: 'a1' });
    const insulation = await project('Loft insulated', { folderId: loft, position: 'a0' });
    await addTask(boiler, 'Book an engineer', 'a0');
    await addTask(insulation, 'Measure the loft', 'a0');
    await project('Shed cleared', { folderId: home, position: 'a2' });

    assert.deepEqual(await outline([home]), [
      { 'Loft insulated': ['Measure the loft'] },
      { 'Boiler serviced': ['Book an engineer'] },
      { 'Shed cleared': [] },
    ]);
  });

  it('refuses a task with a blank title or in a project that does not exist', async () => {
    const id = await project('Taxes');
    const missing = crypto.randomUUID();

    assert.equal(await perform(OperationName.createTask, { taskId: crypto.randomUUID(), projectId: id, title: ' ', position: 'a0' }), 'invalid_title');
    assert.equal(await perform(OperationName.createTask, { taskId: crypto.randomUUID(), projectId: missing, title: 'Ghost', position: 'a0' }), 'not_found');
    assert.deepEqual(await outline([id]), [{ Taxes: [] }]);
  });

  it('keeps a note with a task, records its edits, and treats a blank note as none', async () => {
    const id = await project('Car');
    const taskId = await addTask(id, 'Renew insurance', 'a0');
    const note = 'Policy number 12-345\nRenewal quote due in March';

    assert.equal(await perform(OperationName.editTaskNote, { taskId, note }), 'applied');
    assert.equal((await h.application.task(taskId))?.note, note);
    assert.equal((await h.application.projects([id]))[0]?.tasks[0]?.note, note);

    assert.equal(await perform(OperationName.editTaskNote, { taskId, note: ' \n ' }), 'applied');
    assert.equal((await h.application.task(taskId))?.note, '');
    const history = await h.application.history(taskId);
    assert.deepEqual(history.at(-1)?.changes[0], { entity: 'task', entityId: taskId, kind: 'update', before: { note }, after: { note: '' } });
    assert.equal(await perform(OperationName.editTaskNote, { taskId: crypto.randomUUID(), note: 'Lost' }), 'not_found');
  });

  it('drops a completed task from its project’s outline but keeps when it was completed', async () => {
    const id = await project('Bathroom');
    const done = await addTask(id, 'Order tiles', 'a0');
    await addTask(id, 'Book a plumber', 'a1');

    assert.equal(await perform(OperationName.completeTask, { taskId: done, completedAt: '2026-11-14T08:00:00.000Z' }), 'applied');

    assert.deepEqual(await outline([id]), [{ Bathroom: ['Book a plumber'] }]);
    assert.equal((await h.application.task(done))?.completedAt, '2026-11-14T08:00:00.000Z');
  });

  it('keeps the first completion when a task is completed twice', async () => {
    const id = await project('Admin');
    const taskId = await addTask(id, 'File receipts', 'a0');

    const [first, second] = await Promise.all([
      perform(OperationName.completeTask, { taskId, completedAt: '2026-11-14T08:00:00.000Z' }),
      perform(OperationName.completeTask, { taskId, completedAt: '2026-11-14T09:30:00.000Z' }),
    ]);

    assert.deepEqual([first, second], ['applied', 'applied']);
    const history = await h.application.history(taskId);
    assert.equal(history.filter((entry) => entry.operation === 'complete_task').length, 1);
    assert.equal((await h.application.task(taskId))?.completedAt, history.at(-1)?.changes[0]?.after?.completed_at);
  });

  it('shows completed tasks, with when they were completed, only under Everything', async () => {
    const id = await project('Garage');
    const done = await addTask(id, 'Sweep the floor', 'a0');
    await addTask(id, 'Fix the door', 'a1');
    await perform(OperationName.completeTask, { taskId: done, completedAt: '2026-11-14T15:30:00.000Z' });

    const [everything] = await h.application.projects([id], 'everything');
    assert.deepEqual(
      everything?.tasks.map((t) => [t.title, t.completedAt, t.unavailable]),
      [
        ['Sweep the floor', '2026-11-14T15:30:00.000Z', ['completed']],
        ['Fix the door', null, []],
      ],
    );
    assert.deepEqual(await outline([id]), [{ Garage: ['Fix the door'] }]);
  });

  it('reopens a completed task, which comes back to Remaining with its completion kept in history', async () => {
    const id = await project('Shed');
    const taskId = await addTask(id, 'Oil the hinges', 'a0');
    await perform(OperationName.completeTask, { taskId, completedAt: '2026-11-14T15:30:00.000Z' });

    assert.equal(await perform(OperationName.reopenTask, { taskId }), 'applied');

    assert.deepEqual(await outline([id]), [{ Shed: ['Oil the hinges'] }]);
    assert.equal((await h.application.task(taskId))?.completedAt, null);
    const history = await h.application.history(taskId);
    assert.deepEqual(history.at(-1)?.changes[0], {
      entity: 'task',
      entityId: taskId,
      kind: 'update',
      before: { completed_at: '2026-11-14T15:30:00.000Z' },
      after: { completed_at: null },
    });
    // Reopening it again, as a second device might, changes nothing.
    assert.equal(await perform(OperationName.reopenTask, { taskId }), 'applied');
    assert.equal((await h.application.history(taskId)).filter((entry) => entry.operation === 'reopen_task').length, 1);
    assert.equal(await perform(OperationName.reopenTask, { taskId: crypto.randomUUID() }), 'not_found');
  });

  it('pauses a project, keeping it and its tasks inspectable while none of them is available, and resumes it', async () => {
    const id = await project('Move house');
    const taskId = await addTask(id, 'Order boxes', 'a0');

    assert.equal(await perform(OperationName.pauseProject, { projectId: id }), 'applied');

    const node = (await h.application.organisation()).find((n) => n.id === id);
    assert.equal(node?.type === 'project' && node.status, 'paused');
    const [paused] = await h.application.projects([id]);
    assert.deepEqual([paused?.project.status, paused?.tasks.map((t) => [t.title, t.unavailable])], ['paused', [['Order boxes', ['paused']]]]);
    assert.deepEqual((await h.application.projects([id], 'available'))[0]?.tasks, []);
    assert.deepEqual((await h.application.task(taskId))?.unavailable, ['paused']);
    // Pausing it again, as a second device might, changes nothing.
    assert.equal(await perform(OperationName.pauseProject, { projectId: id }), 'applied');

    assert.equal(await perform(OperationName.resumeProject, { projectId: id }), 'applied');

    assert.deepEqual((await h.application.task(taskId))?.unavailable, []);
    assert.deepEqual(await outline([id]), [{ 'Move house': ['Order boxes'] }]);
    assert.equal(await perform(OperationName.pauseProject, { projectId: crypto.randomUUID() }), 'not_found');
  });

  it('never treats a single-action list as complete because it is empty', async () => {
    const id = await project('Miscellaneous', { kind: 'single_actions' });
    const only = await addTask(id, 'Post the parcel', 'a0');

    await perform(OperationName.completeTask, { taskId: only });

    const [list] = await h.application.projects([id]);
    assert.deepEqual([list?.project.kind, list?.tasks], ['single_actions', []]);
    assert.ok(JSON.stringify(await h.application.organisation()).includes(id));
    await addTask(id, 'Buy stamps', 'a1');
    assert.deepEqual(await outline([id]), [{ Miscellaneous: ['Buy stamps'] }]);
  });

  it('reorders a task by changing only that task', async () => {
    const id = await project('Move house');
    await addTask(id, 'Get quotes from movers', 'a0');
    await addTask(id, 'Order boxes', 'a1');
    const last = await addTask(id, 'Redirect post', 'a2');

    assert.equal(await perform(OperationName.reorderTask, { taskId: last, position: 'a0V' }), 'applied');
    assert.equal(await perform(OperationName.reorderTask, { taskId: last, position: 'oops' }), 'invalid_position');

    assert.deepEqual(await outline([id]), [{ 'Move house': ['Get quotes from movers', 'Redirect post', 'Order boxes'] }]);
    const history = await h.application.history(last);
    assert.deepEqual(history.at(-1)?.changes, [{ entity: 'task', entityId: last, kind: 'update', before: { position: 'a2' }, after: { position: 'a0V' } }]);
  });

  it('records the new task in its history', async () => {
    const id = await project('Holiday');
    const taskId = await addTask(id, 'Book flights', 'a0');

    const [entry] = await h.application.history(taskId);
    assert.equal(entry?.operation, 'create_task');
    assert.deepEqual(entry?.actor, owner);
    assert.deepEqual(entry?.changes[0]?.after, { title: 'Book flights', project_id: id, position: 'a0', created_at: '2026-11-13T10:00:00.000Z' });
  });
});
