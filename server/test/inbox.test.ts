import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { OperationName } from '@salamifocus/domain';
import { captureRequest, createHarness, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());
beforeEach(async () => {
  await h.sql`TRUNCATE tasks, captures, projects, folders, tags CASCADE`;
});

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function project(name: string, kind = 'project') {
  const projectId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createProject, { projectId, name, kind, folderId: null, position: 'a0' }), 'applied');
  return projectId;
}

async function tag(name: string) {
  const tagId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTag, { tagId, name, parentId: null, position: 'a0' }), 'applied');
  return tagId;
}

async function capture(text: string) {
  const capture = captureRequest(text);
  assert.equal((await h.application.execute(capture)).outcome, 'applied');
  return capture.taskId;
}

async function tagTask(taskId: string, tagId: string) {
  assert.equal(await perform(OperationName.tagTask, { taskTagId: crypto.randomUUID(), taskId, tagId }), 'applied');
}

async function createTask(title: string, projectId: string | null, tagIds: string[] = []) {
  const taskId = crypto.randomUUID();
  const tags = tagIds.map((tagId) => ({ taskTagId: crypto.randomUUID(), tagId }));
  const position = projectId === null ? null : 'a0';
  assert.equal(await perform(OperationName.createTask, { taskId, projectId, title, position, tags }), 'applied');
  return taskId;
}

/** Sorted, since captures made in one test share a capture time. */
const inboxTitles = async () => (await h.application.inbox()).map((entry) => entry.title).sort();

describe('the Inbox', () => {
  it('holds unfinished tasks until they have both a project and a tag', async () => {
    const errand = await tag('@Errand');
    const garden = await project('Garden');
    const misc = await project('Miscellaneous', 'single_actions');

    await capture('call the plumber');
    const tagged = await capture('buy stamps');
    await tagTask(tagged, errand);
    await createTask('Mow the lawn', garden);
    await createTask('Prune the roses', garden, [errand]);
    await createTask('Return library books', misc, [errand]);

    assert.deepEqual(await inboxTitles(), ['Mow the lawn', 'buy stamps', 'call the plumber']);
  });

  it('takes a task back when it loses its last tag', async () => {
    const errand = await tag('@Errand');
    const taskId = await createTask('Post the parcel', await project('Errands'), [errand]);
    assert.deepEqual(await inboxTitles(), []);

    assert.equal(await perform(OperationName.untagTask, { taskId, tagId: errand }), 'applied');

    assert.deepEqual(await inboxTitles(), ['Post the parcel']);
  });

  it('never shows completed tasks, whatever they lack', async () => {
    const taskId = await capture('book eye test');

    assert.equal(await perform(OperationName.completeTask, { taskId }), 'applied');

    assert.deepEqual(await inboxTitles(), []);
  });
});
