import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { operationMetadata, OperationName, settingsId } from '@salamifocus/domain';
import { createHarness, createHttpHarness, type Harness } from './harness.ts';

let h: Harness;
let api: Awaited<ReturnType<typeof createHttpHarness>>;
let token: string;
before(async () => {
  h = await createHarness();
  api = await createHttpHarness(h);
  token = await api.signIn('android');
});
after(() => h.close());

// What a client's upload queue holds after it captures text: two rows written
// in one local transaction, both tagged with the same operation.
function captureTransaction(text: string) {
  const taskId = crypto.randomUUID();
  const opId = crypto.randomUUID();
  const metadata = operationMetadata(OperationName.captureText, opId);
  const capturedAt = '2026-11-13T07:45:12.345Z';
  return {
    taskId,
    opId,
    entries: [
      { op: 'PUT', table: 'tasks', id: taskId, data: { title: text.trim(), created_at: capturedAt }, metadata },
      { op: 'PUT', table: 'captures', id: crypto.randomUUID(), data: { task_id: taskId, text, captured_at: capturedAt }, metadata },
    ],
  };
}

function renameTransaction(taskId: string, title: string, previous: string, data: Record<string, unknown> = { title }) {
  const opId = crypto.randomUUID();
  return {
    opId,
    entries: [{ op: 'PATCH', table: 'tasks', id: taskId, data, old: { title: previous }, metadata: operationMetadata(OperationName.renameTask, opId) }],
  };
}

const upload = async (entries: unknown[]) => {
  const response = await api.request('/api/sync/upload', { body: { entries }, token });
  assert.equal(response.status, 200);
  return ((await response.json()) as { results: { opId: string; outcome: string; duplicate: boolean; code?: string }[] }).results;
};

describe('uploading a client transaction', () => {
  it('applies a capture and attributes it to the signed-in client', async () => {
    const capture = captureTransaction('Pick up dry cleaning ');

    const results = await upload(capture.entries);

    assert.deepEqual(results, [{ opId: capture.opId, outcome: 'applied', duplicate: false }]);
    const task = await h.application.task(capture.taskId);
    assert.equal(task?.title, 'Pick up dry cleaning');
    assert.equal(task?.capture?.text, 'Pick up dry cleaning ');
    const [entry] = await h.application.history(capture.taskId);
    assert.equal(entry?.source, 'android');
    assert.deepEqual(entry?.actor, { type: 'user', id: 'owner' });
  });

  it('applies a rename', async () => {
    const capture = captureTransaction('Pay council tax');
    await upload(capture.entries);
    const rename = renameTransaction(capture.taskId, 'Pay council tax for December', 'Pay council tax');

    assert.equal((await upload(rename.entries))[0]?.outcome, 'applied');
    assert.equal((await h.application.task(capture.taskId))?.title, 'Pay council tax for December');
  });

  it('acknowledges a retry after a lost acknowledgement without applying it twice', async () => {
    const capture = captureTransaction('Order printer ink');
    await upload(capture.entries);

    const retry = await upload(capture.entries);

    assert.deepEqual(retry, [{ opId: capture.opId, outcome: 'applied', duplicate: true }]);
    assert.equal((await h.application.history(capture.taskId)).length, 1);
  });

  it('records and acknowledges a rejected operation so the queue keeps moving', async () => {
    const capture = captureTransaction('Email landlord');
    await upload(capture.entries);
    const rename = renameTransaction(capture.taskId, '', 'Email landlord');

    const [result] = await upload(rename.entries);

    assert.equal(result?.outcome, 'rejected');
    const record = await h.application.operation(rename.opId);
    assert.equal(record?.source, 'android');
    assert.deepEqual(record?.submitted, rename.entries);
  });

  it('rejects rows that do not match the shape of their operation', async () => {
    const capture = captureTransaction('Return library books');
    await upload(capture.entries);
    const sneaky = renameTransaction(capture.taskId, 'Renamed', 'Return library books', { title: 'Renamed', created_at: '2000-01-01' });

    const [result] = await upload(sneaky.entries);

    assert.equal(result?.code, 'malformed_operation');
    assert.equal((await h.application.task(capture.taskId))?.title, 'Return library books');
  });

  it('rejects rows written without an operation, keeping them for inspection', async () => {
    const [result] = await upload([{ op: 'PUT', table: 'tasks', id: crypto.randomUUID(), data: { title: 'Untagged' } }]);

    assert.equal(result?.outcome, 'rejected');
    assert.equal(result?.code, 'missing_metadata');
    assert.equal((await h.application.operation(result!.opId))?.outcome, 'rejected');
  });

  it('applies folder and project changes, one operation per tagged group of rows', async () => {
    const folderId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const createFolder = operationMetadata(OperationName.createFolder);
    const createProject = operationMetadata(OperationName.createProject);
    const moveProject = operationMetadata(OperationName.moveProject);

    const results = await upload([
      { op: 'PUT', table: 'folders', id: folderId, data: { name: 'Home', position: 'a0' }, metadata: createFolder },
      { op: 'PUT', table: 'projects', id: projectId, data: { name: 'Boiler serviced', kind: 'project', position: 'a0' }, metadata: createProject },
      { op: 'PATCH', table: 'projects', id: projectId, data: { folder_id: folderId }, metadata: moveProject },
    ]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied', 'applied', 'applied']);
    const home = (await h.application.organisation()).find((node) => node.id === folderId);
    assert.deepEqual(home?.type === 'folder' && home.children.map((child) => child.name), ['Boiler serviced']);
  });

  it('applies tag changes', async () => {
    const parent = crypto.randomUUID();
    const child = crypto.randomUUID();
    const createTag = operationMetadata(OperationName.createTag);

    const results = await upload([
      { op: 'PUT', table: 'tags', id: parent, data: { name: '@Computer', position: 'a0' }, metadata: createTag },
      { op: 'PUT', table: 'tags', id: child, data: { name: 'Shallow', position: 'a1' }, metadata: operationMetadata(OperationName.createTag) },
      { op: 'PATCH', table: 'tags', id: child, data: { parent_id: parent }, metadata: operationMetadata(OperationName.moveTag) },
      { op: 'PATCH', table: 'tags', id: child, data: { name: 'Shallow work' }, metadata: operationMetadata(OperationName.renameTag) },
    ]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied', 'applied', 'applied', 'applied']);
    const computer = (await h.application.tags()).find((node) => node.id === parent);
    assert.deepEqual(computer?.children.map((c) => c.name), ['Shallow work']);
  });

  it('adds a tag to a task and removes it again by deleting the link', async () => {
    const capture = captureTransaction('Buy stamps');
    const tagId = crypto.randomUUID();
    const taskTagId = crypto.randomUUID();
    await upload(capture.entries);
    await upload([{ op: 'PUT', table: 'tags', id: tagId, data: { name: '@Errand', position: 'a0' }, metadata: operationMetadata(OperationName.createTag) }]);

    const [added] = await upload([
      { op: 'PUT', table: 'task_tags', id: taskTagId, data: { task_id: capture.taskId, tag_id: tagId }, metadata: operationMetadata(OperationName.tagTask) },
    ]);
    assert.equal(added?.outcome, 'applied');
    assert.deepEqual((await h.application.task(capture.taskId))?.tags.map((t) => t.name), ['@Errand']);

    const old = { task_id: capture.taskId, tag_id: tagId };
    const [removed] = await upload([{ op: 'DELETE', table: 'task_tags', id: taskTagId, old, metadata: operationMetadata(OperationName.untagTask) }]);
    assert.equal(removed?.outcome, 'applied');
    assert.deepEqual((await h.application.task(capture.taskId))?.tags, []);
  });

  it('creates a task with its tags as one operation', async () => {
    const tagId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await upload([{ op: 'PUT', table: 'tags', id: tagId, data: { name: '@Phone', position: 'a0' }, metadata: operationMetadata(OperationName.createTag) }]);
    const metadata = operationMetadata(OperationName.createTask);

    const results = await upload([
      { op: 'PUT', table: 'tasks', id: taskId, data: { title: 'Call the bank', created_at: '2026-11-13T09:00:00.000Z' }, metadata },
      { op: 'PUT', table: 'task_tags', id: crypto.randomUUID(), data: { task_id: taskId, tag_id: tagId }, metadata },
    ]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied']);
    assert.deepEqual((await h.application.task(taskId))?.tags.map((t) => t.name), ['@Phone']);
  });

  it('moves a task into a project, keeping its position when only the project changes', async () => {
    const garden = crypto.randomUUID();
    const house = crypto.randomUUID();
    const projectMetadata = () => operationMetadata(OperationName.createProject);
    await upload([{ op: 'PUT', table: 'projects', id: garden, data: { name: 'Garden', kind: 'project', position: 'a0' }, metadata: projectMetadata() }]);
    await upload([{ op: 'PUT', table: 'projects', id: house, data: { name: 'House', kind: 'project', position: 'a1' }, metadata: projectMetadata() }]);
    const capture = captureTransaction('fix the gate');
    await upload(capture.entries);
    const move = (data: Record<string, unknown>) => ({ op: 'PATCH', table: 'tasks', id: capture.taskId, data, metadata: operationMetadata(OperationName.moveTask) });

    const results = await upload([move({ project_id: garden, position: 'a3' }), move({ project_id: house })]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied', 'applied']);
    assert.deepEqual((await h.application.projects([house]))[0]?.tasks.map((t) => t.title), ['fix the gate']);
    const [rejected] = await upload([move({ position: 'a4' })]);
    assert.equal(rejected?.code, 'malformed_operation');
  });

  it('nests a task beneath another and adds a task beneath it', async () => {
    const projectId = crypto.randomUUID();
    const [parent, child, added] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const createdAt = '2026-11-13T09:00:00.000Z';
    const createProject = operationMetadata(OperationName.createProject);
    await upload([{ op: 'PUT', table: 'projects', id: projectId, data: { name: 'Report', kind: 'project', position: 'a0' }, metadata: createProject }]);
    for (const [id, title, position] of [[parent, 'Compile the report', 'a0'], [child, 'Email Steve', 'a1']] as const) {
      const data = { title, project_id: projectId, position, created_at: createdAt };
      await upload([{ op: 'PUT', table: 'tasks', id, data, metadata: operationMetadata(OperationName.createTask) }]);
    }

    const results = await upload([
      { op: 'PATCH', table: 'tasks', id: child, data: { parent_id: parent, position: 'a0' }, old: { parent_id: null, position: 'a1' }, metadata: operationMetadata(OperationName.nestTask) },
      {
        op: 'PUT',
        table: 'tasks',
        id: added,
        data: { title: 'Find the document', project_id: projectId, parent_id: child, position: 'a0', created_at: createdAt },
        metadata: operationMetadata(OperationName.createTask),
      },
    ]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied', 'applied']);
    const [outline] = await h.application.projects([projectId]);
    assert.deepEqual(outline?.tasks.map((t) => [t.title, t.depth]), [['Compile the report', 1], ['Email Steve', 2], ['Find the document', 3]]);
  });

  it('defers a task and clears its defer date, and refuses a defer that changes anything else', async () => {
    const { taskId, entries } = captureTransaction('chase the insurer');
    await upload(entries);
    const defer = (data: Record<string, unknown>) => ({ op: 'PATCH', table: 'tasks', id: taskId, data, metadata: operationMetadata(OperationName.deferTask) });

    // PowerSync sends the time as the client stored it.
    assert.deepEqual((await upload([defer({ defer_until: '2026-11-30T00:00:00.000Z' })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.deferUntil, '2026-11-30T00:00:00.000Z');
    assert.deepEqual((await upload([defer({ defer_until: null })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.deferUntil, null);
    const [rejected] = await upload([defer({ defer_until: '2026-11-30T00:00:00.000Z', title: 'something else' })]);
    assert.equal(rejected?.code, 'malformed_operation');
  });

  it('completes a task and reopens it, refusing a reopening that sets a completion time', async () => {
    const { taskId, entries } = captureTransaction('renew the parking permit');
    await upload(entries);
    const patch = (op: OperationName, data: Record<string, unknown>) => ({ op: 'PATCH', table: 'tasks', id: taskId, data, metadata: operationMetadata(op) });

    await upload([patch(OperationName.completeTask, { completed_at: '2026-11-14T15:30:00.000Z' })]);
    assert.deepEqual((await upload([patch(OperationName.reopenTask, { completed_at: null })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.completedAt, null);
    const [rejected] = await upload([patch(OperationName.reopenTask, { completed_at: '2026-11-14T15:30:00.000Z' })]);
    assert.equal(rejected?.code, 'malformed_operation');
  });

  it('reopens a task with the completed tasks it is beneath, the client sending its own copy of reopening them', async () => {
    const projectId = crypto.randomUUID();
    const [parent, child] = [crypto.randomUUID(), crypto.randomUUID()];
    const create = (taskId: string, parentId: string | null) => ({
      op: 'PUT',
      table: 'tasks',
      id: taskId,
      data: { title: 'Plaster the wall', project_id: projectId, parent_id: parentId, position: 'a0', created_at: '2026-11-13T10:00:00.000Z' },
      metadata: operationMetadata(OperationName.createTask),
    });
    await upload([{ op: 'PUT', table: 'projects', id: projectId, data: { name: 'Hallway', kind: 'project', folder_id: null, position: 'a0' }, metadata: operationMetadata(OperationName.createProject) }]);
    await upload([create(parent, null)]);
    await upload([create(child, parent)]);
    const patch = (taskId: string, op: OperationName, data: Record<string, unknown>, metadata = operationMetadata(op)) => ({ op: 'PATCH', table: 'tasks', id: taskId, data, metadata });
    await upload([patch(child, OperationName.completeTask, { completed_at: '2026-11-14T15:30:00.000Z' })]);
    await upload([patch(parent, OperationName.completeTask, { completed_at: '2026-11-14T15:30:00.000Z' })]);

    const metadata = operationMetadata(OperationName.reopenTask);
    const results = await upload([patch(child, OperationName.reopenTask, { completed_at: null }, metadata), patch(parent, OperationName.reopenTask, { completed_at: null }, metadata)]);

    assert.deepEqual(results.map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(parent))?.completedAt, null);
    const another = operationMetadata(OperationName.reopenTask);
    const [renamed] = await upload([patch(child, OperationName.reopenTask, { completed_at: null }, another), patch(parent, OperationName.reopenTask, { title: 'x' }, another)]);
    assert.equal(renamed?.code, 'malformed_operation');
  });

  it('sets and clears a due date', async () => {
    const { taskId, entries } = captureTransaction('file the tax return');
    await upload(entries);
    const due = (data: Record<string, unknown>) => ({ op: 'PATCH', table: 'tasks', id: taskId, data, metadata: operationMetadata(OperationName.setTaskDue) });

    assert.deepEqual((await upload([due({ due_at: '2026-11-20T17:00:00.000Z' })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.dueAt, '2026-11-20T17:00:00.000Z');
    assert.deepEqual((await upload([due({ due_at: null })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.dueAt, null);
    const [rejected] = await upload([due({ due_at: '2026-11-20T17:00:00.000Z', defer_until: null })]);
    assert.equal(rejected?.code, 'malformed_operation');
  });

  it('defers a project and sets its due date, refusing either if it changes anything else', async () => {
    const projectId = crypto.randomUUID();
    await upload([{ op: 'PUT', table: 'projects', id: projectId, data: { name: 'Conference', kind: 'project', position: 'a0' }, metadata: operationMetadata(OperationName.createProject) }]);
    const patch = (op: OperationName, data: Record<string, unknown>) => ({ op: 'PATCH', table: 'projects', id: projectId, data, metadata: operationMetadata(op) });
    const project = async () => (await h.application.projects([projectId]))[0]?.project;

    const results = await upload([
      patch(OperationName.deferProject, { defer_until: '2026-12-01T00:00:00.000Z' }),
      patch(OperationName.setProjectDue, { due_at: '2026-12-10T17:00:00.000Z' }),
    ]);
    assert.deepEqual(results.map((r) => r.outcome), ['applied', 'applied']);
    assert.deepEqual([(await project())?.deferUntil, (await project())?.dueAt], ['2026-12-01T00:00:00.000Z', '2026-12-10T17:00:00.000Z']);
    assert.deepEqual((await upload([patch(OperationName.deferProject, { defer_until: null })])).map((r) => r.outcome), ['applied']);
    assert.equal((await project())?.deferUntil, null);
    const rejected = await upload([
      patch(OperationName.deferProject, { defer_until: '2026-12-01T00:00:00.000Z', name: 'Renamed' }),
      patch(OperationName.setProjectDue, { due_at: null, defer_until: null }),
    ]);
    assert.deepEqual(rejected.map((r) => r.code), ['malformed_operation', 'malformed_operation']);
  });

  it('pauses and resumes a project, refusing a pause that sets any other status', async () => {
    const projectId = crypto.randomUUID();
    await upload([
      { op: 'PUT', table: 'projects', id: projectId, data: { name: 'Move house', kind: 'project', folder_id: null, position: 'a0' }, metadata: operationMetadata(OperationName.createProject) },
    ]);
    const patch = (op: OperationName, data: Record<string, unknown>) => ({ op: 'PATCH', table: 'projects', id: projectId, data, metadata: operationMetadata(op) });
    const status = async () => (await h.application.projects([projectId]))[0]?.project.status;

    assert.deepEqual((await upload([patch(OperationName.pauseProject, { status: 'paused' })])).map((r) => r.outcome), ['applied']);
    assert.equal(await status(), 'paused');
    assert.deepEqual((await upload([patch(OperationName.resumeProject, { status: 'active' })])).map((r) => r.outcome), ['applied']);
    assert.equal(await status(), 'active');
    const [rejected] = await upload([patch(OperationName.pauseProject, { status: 'active' })]);
    assert.equal(rejected?.code, 'malformed_operation');
  });

  it('flags and unflags a task, as a client stores the flag, refusing a flag that sets anything else', async () => {
    const { taskId, entries } = captureTransaction('book the dentist');
    await upload(entries);
    const patch = (op: OperationName, data: Record<string, unknown>) => ({ op: 'PATCH', table: 'tasks', id: taskId, data, metadata: operationMetadata(op) });

    assert.deepEqual((await upload([patch(OperationName.flagTask, { flagged: 1 })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.flagged, true);
    assert.deepEqual((await upload([patch(OperationName.unflagTask, { flagged: 0 })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.task(taskId))?.flagged, false);
    const refused = await upload([patch(OperationName.flagTask, { flagged: 0 }), patch(OperationName.flagTask, { flagged: 1, title: 'Book the dentist' })]);
    assert.deepEqual(refused.map((r) => r.code), ['malformed_operation', 'malformed_operation']);
  });

  it('designates the folder an Actionable perspective shows, one scope at a time', async () => {
    const folderId = crypto.randomUUID();
    await upload([{ op: 'PUT', table: 'folders', id: folderId, data: { name: 'Personal', parent_id: null, position: 'a0' }, metadata: operationMetadata(OperationName.createFolder) }]);
    const patch = (data: Record<string, unknown>, id = settingsId) => ({ op: 'PATCH', table: 'settings', id, data, metadata: operationMetadata(OperationName.designateFolder) });

    assert.deepEqual((await upload([patch({ personal_folder_id: folderId })])).map((r) => r.outcome), ['applied']);
    assert.deepEqual((await h.application.settings()).folders, { personal: folderId, work: null });
    assert.deepEqual((await upload([patch({ personal_folder_id: null })])).map((r) => r.outcome), ['applied']);
    assert.deepEqual((await h.application.settings()).folders, { personal: null, work: null });
    const rejected = await upload([patch({ personal_folder_id: folderId, work_folder_id: folderId }), patch({ work_folder_id: folderId }, crypto.randomUUID())]);
    assert.deepEqual(rejected.map((r) => r.code), ['malformed_operation', 'malformed_operation']);
  });

  it('designates the People tag, and nothing else in the same change', async () => {
    const tagId = crypto.randomUUID();
    await upload([{ op: 'PUT', table: 'tags', id: tagId, data: { name: 'People', parent_id: null, position: 'a0' }, metadata: operationMetadata(OperationName.createTag) }]);
    const patch = (data: Record<string, unknown>, id = settingsId) => ({ op: 'PATCH', table: 'settings', id, data, metadata: operationMetadata(OperationName.designatePeopleTag) });

    assert.deepEqual((await upload([patch({ people_tag_id: tagId })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.settings()).peopleTagId, tagId);
    assert.deepEqual((await upload([patch({ people_tag_id: null })])).map((r) => r.outcome), ['applied']);
    assert.equal((await h.application.settings()).peopleTagId, null);
    const rejected = await upload([patch({ people_tag_id: tagId, work_folder_id: null }), patch({ people_tag_id: tagId }, crypto.randomUUID())]);
    assert.deepEqual(rejected.map((r) => r.code), ['malformed_operation', 'malformed_operation']);
  });

  it('moves a task with its children, the client sending its own copy of their move', async () => {
    const [from, to] = [crypto.randomUUID(), crypto.randomUUID()];
    const [parent, child] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [id, name, position] of [[from, 'Office move', 'a0'], [to, 'Home office', 'a1']] as const) {
      await upload([{ op: 'PUT', table: 'projects', id, data: { name, kind: 'project', position }, metadata: operationMetadata(OperationName.createProject) }]);
    }
    const createdAt = '2026-11-13T09:00:00.000Z';
    await upload([{ op: 'PUT', table: 'tasks', id: parent, data: { title: 'Set up the desk', project_id: from, position: 'a0', created_at: createdAt }, metadata: operationMetadata(OperationName.createTask) }]);
    await upload([
      { op: 'PUT', table: 'tasks', id: child, data: { title: 'Order a chair', project_id: from, parent_id: parent, position: 'a0', created_at: createdAt }, metadata: operationMetadata(OperationName.createTask) },
    ]);
    const move = (childData: Record<string, unknown>) => {
      const metadata = operationMetadata(OperationName.moveTask);
      return [
        { op: 'PATCH', table: 'tasks', id: parent, data: { project_id: to }, metadata },
        { op: 'PATCH', table: 'tasks', id: child, data: childData, metadata },
      ];
    };

    const [sneaky] = await upload(move({ project_id: to, title: 'Renamed' }));
    assert.equal(sneaky?.code, 'malformed_operation');
    const [moved] = await upload(move({ project_id: to }));

    assert.equal(moved?.outcome, 'applied');
    const [outline] = await h.application.projects([to]);
    assert.deepEqual(outline?.tasks.map((t) => [t.title, t.depth]), [['Set up the desk', 1], ['Order a chair', 2]]);
  });

  it('rejects a move that also renames', async () => {
    const projectId = crypto.randomUUID();
    await upload([
      { op: 'PUT', table: 'projects', id: projectId, data: { name: 'Garden', kind: 'project', position: 'a0' }, metadata: operationMetadata(OperationName.createProject) },
    ]);

    const [result] = await upload([
      { op: 'PATCH', table: 'projects', id: projectId, data: { position: 'a1', name: 'Sneaky' }, metadata: operationMetadata(OperationName.moveProject) },
    ]);

    assert.equal(result?.code, 'malformed_operation');
  });

  it('refuses a body that is not a list of entries', async () => {
    const response = await api.request('/api/sync/upload', { body: { nope: true }, token });
    assert.equal(response.status, 400);
  });
});
