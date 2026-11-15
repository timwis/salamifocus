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
async function moveTask(taskId: string, projectId: string | null, position: string | null = 'a0') {
  return perform(OperationName.moveTask, { taskId, projectId, position });
}

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

  it('keeps a capture given only a project, or only a tag, and lets it go once it has both', async () => {
    const errand = await tag('@Errand');
    const misc = await project('Miscellaneous', 'single_actions');
    const projectFirst = await capture('post the parcel');
    const tagFirst = await capture('buy stamps');

    assert.equal(await moveTask(projectFirst, misc), 'applied');
    await tagTask(tagFirst, errand);
    assert.deepEqual(await inboxTitles(), ['buy stamps', 'post the parcel']);

    await tagTask(projectFirst, errand);
    assert.equal(await moveTask(tagFirst, misc, 'a1'), 'applied');
    assert.deepEqual(await inboxTitles(), []);
    assert.deepEqual((await h.application.projects([misc]))[0]?.tasks.map((t) => t.title), ['post the parcel', 'buy stamps']);
  });

  it('records a move as one change to the task, and keeps the original capture', async () => {
    const garden = await project('Garden');
    const taskId = await capture('sort out the hedge');
    assert.equal(await perform(OperationName.renameTask, { taskId, title: 'Book a hedge trimmer' }), 'applied');

    assert.equal(await moveTask(taskId, garden), 'applied');

    const task = await h.application.task(taskId);
    assert.deepEqual([task?.title, task?.projectId, task?.capture?.text], ['Book a hedge trimmer', garden, 'sort out the hedge']);
    const moved = (await h.application.history(taskId)).at(-1);
    assert.equal(moved?.operation, OperationName.moveTask);
    assert.deepEqual(moved?.changes.map(({ before, after }) => ({ before, after })), [
      { before: { project_id: null, position: null }, after: { project_id: garden, position: 'a0' } },
    ]);
  });

  it('moves a task between projects, keeping its position when none is given, and back out of any', async () => {
    const garden = await project('Garden');
    const house = await project('House');
    const taskId = await createTask('Fix the gate', garden);

    assert.equal(await perform(OperationName.moveTask, { taskId, projectId: house }), 'applied');
    assert.equal((await h.application.task(taskId))?.projectId, house);

    assert.equal(await moveTask(taskId, null, null), 'applied');
    assert.deepEqual(await inboxTitles(), ['Fix the gate']);
    assert.deepEqual((await h.application.projects([house]))[0]?.tasks, []);
  });

  it('refuses a move to a missing project, without a position, or with a position but no project', async () => {
    const garden = await project('Garden');
    const taskId = await capture('water the beds');

    assert.equal(await moveTask(taskId, crypto.randomUUID()), 'not_found');
    assert.equal(await moveTask(taskId, garden, null), 'invalid_position');
    assert.equal(await perform(OperationName.moveTask, { taskId, projectId: garden }), 'invalid_position');
    assert.equal(await moveTask(taskId, garden, 'not a key!'), 'invalid_position');
    assert.equal(await moveTask(taskId, null, 'a0'), 'invalid_position');
    assert.equal(await perform(OperationName.moveTask, { taskId }), 'invalid_arguments');
    assert.equal(await moveTask(crypto.randomUUID(), garden), 'not_found');

    assert.equal((await h.application.task(taskId))?.projectId, null);
    assert.equal((await h.application.history(taskId)).length, 1);
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
