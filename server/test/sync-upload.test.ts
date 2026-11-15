import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { operationMetadata, OperationName } from '@salamifocus/domain';
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

    const [removed] = await upload([{ op: 'DELETE', table: 'task_tags', id: taskTagId, metadata: operationMetadata(OperationName.untagTask) }]);
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
