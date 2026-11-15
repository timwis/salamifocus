import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { OperationName, type TagNode } from '@salamifocus/domain';
import { captureRequest, createHarness, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());
beforeEach(async () => {
  await h.sql`TRUNCATE tags CASCADE`;
});

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function tag(name: string, parentId: string | null, position: string) {
  const tagId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTag, { tagId, name, parentId, position }), 'applied');
  return tagId;
}

/** The sidebar as names, so assertions read like the screen. */
const outline = (nodes: TagNode[]): unknown[] => nodes.map((n) => (n.children.length > 0 ? { [n.name]: outline(n.children) } : n.name));
const sidebar = async () => outline(await h.application.tags());

describe('organising tags', () => {
  it('nests tags to any depth, in the order given', async () => {
    const computer = await tag('@Computer', null, 'a1');
    await tag('People', null, 'a0');
    const shallow = await tag('Shallow work', computer, 'a1');
    await tag('Deep work', computer, 'a0');
    await tag('Low energy', shallow, 'a0');
    await tag('Online shopping', shallow, 'a1');

    assert.deepEqual(await sidebar(), ['People', { '@Computer': ['Deep work', { 'Shallow work': ['Low energy', 'Online shopping'] }] }]);
  });

  it('renames a tag by identity and refuses blank names', async () => {
    const first = await tag('Errand', null, 'a0');
    await tag('Errand', null, 'a1');

    assert.equal(await perform(OperationName.renameTag, { tagId: first, name: ' @Errand ' }), 'applied');
    assert.equal(await perform(OperationName.renameTag, { tagId: first, name: '  ' }), 'invalid_name');

    assert.deepEqual(await sidebar(), ['@Errand', 'Errand']);
  });

  it('moves tags under other tags, back to the top level, and among siblings', async () => {
    const phone = await tag('@Phone', null, 'a0');
    const computer = await tag('@Computer', null, 'a1');
    const coding = await tag('Coding', null, 'a2');

    assert.equal(await perform(OperationName.moveTag, { tagId: coding, parentId: computer, position: 'a0' }), 'applied');
    assert.equal(await perform(OperationName.moveTag, { tagId: phone, position: 'a5' }), 'applied');
    assert.deepEqual(await sidebar(), [{ '@Computer': ['Coding'] }, '@Phone']);

    assert.equal(await perform(OperationName.moveTag, { tagId: coding, parentId: null, position: 'a0' }), 'applied');
    assert.deepEqual(await sidebar(), ['Coding', '@Computer', '@Phone']);
  });

  it('answers, rather than looping, when stored tags already form a cycle, and lets the cycle be broken', async () => {
    const x = await tag('X', null, 'a0');
    const y = await tag('Y', x, 'a0');
    const loose = await tag('Loose', null, 'a1');
    await h.sql`UPDATE tags SET parent_id = ${y} WHERE id = ${x}`;

    assert.equal(await perform(OperationName.moveTag, { tagId: loose, parentId: x, position: 'a0' }), 'would_nest_in_itself');
    assert.equal(await perform(OperationName.moveTag, { tagId: x, parentId: null, position: 'a2' }), 'applied');
    assert.deepEqual(await sidebar(), ['Loose', { X: ['Y'] }]);
  });

  it('refuses to put a tag inside itself or its descendants, or under a tag that does not exist', async () => {
    const outer = await tag('Outer', null, 'a0');
    const inner = await tag('Inner', outer, 'a0');

    assert.equal(await perform(OperationName.moveTag, { tagId: outer, parentId: inner, position: 'a0' }), 'would_nest_in_itself');
    assert.equal(await perform(OperationName.moveTag, { tagId: outer, parentId: outer, position: 'a0' }), 'would_nest_in_itself');
    assert.equal(await perform(OperationName.moveTag, { tagId: inner, parentId: crypto.randomUUID(), position: 'a0' }), 'not_found');
    assert.equal(await perform(OperationName.createTag, { tagId: outer, name: 'Again', parentId: null, position: 'a1' }), 'already_exists');

    assert.deepEqual(await sidebar(), [{ Outer: ['Inner'] }]);
  });
});

describe('tagging tasks', () => {
  async function captured(text: string) {
    const capture = captureRequest(text);
    await h.application.execute(capture);
    return capture.taskId;
  }

  async function addTag(taskId: string, tagId: string, taskTagId: string = crypto.randomUUID()) {
    return { outcome: await perform(OperationName.tagTask, { taskTagId, taskId, tagId }), taskTagId };
  }

  const tagNames = async (taskId: string) => (await h.application.task(taskId))?.tags.map((t) => t.path.join(' : '));

  it('puts several tags on a task, listed in sidebar order with their full paths', async () => {
    const people = await tag('People', null, 'a0');
    const dad = await tag('Dad', people, 'a0');
    const computer = await tag('@Computer', null, 'a1');
    const lowEnergy = await tag('Low energy', computer, 'a0');
    const taskId = await captured('Ask Dad about AAA checkup');

    assert.equal((await addTag(taskId, lowEnergy)).outcome, 'applied');
    assert.equal((await addTag(taskId, dad)).outcome, 'applied');

    assert.deepEqual(await tagNames(taskId), ['People : Dad', '@Computer : Low energy']);
  });

  it('keeps one link when the same tag is added twice, as from two offline devices', async () => {
    const errand = await tag('@Errand', null, 'a0');
    const taskId = await captured('Post the parcel');

    const first = await addTag(taskId, errand);
    const second = await addTag(taskId, errand);

    assert.deepEqual([first.outcome, second.outcome], ['applied', 'applied']);
    assert.deepEqual(await tagNames(taskId), ['@Errand']);
    const additions = (await h.application.history(taskId)).filter((entry) => entry.operation === OperationName.tagTask);
    assert.equal(additions.length, 1);
  });

  it('removes a tag, records what was removed in the task’s history, and ignores a second removal', async () => {
    const phone = await tag('@Phone', null, 'a0');
    const flat = await tag('@Flat', null, 'a1');
    const taskId = await captured('Call the landlord');
    const { taskTagId } = await addTag(taskId, phone);
    await addTag(taskId, flat);

    assert.equal(await perform(OperationName.untagTask, { taskId, tagId: phone }), 'applied');
    assert.equal(await perform(OperationName.untagTask, { taskId, tagId: phone }), 'applied');

    assert.deepEqual(await tagNames(taskId), ['@Flat']);
    const removals = (await h.application.history(taskId)).filter((entry) => entry.operation === OperationName.untagTask);
    assert.deepEqual(
      removals.map((entry) => entry.changes),
      [[{ entity: 'task_tag', entityId: taskTagId, kind: 'delete', before: { task_id: taskId, tag_id: phone }, after: null }]],
    );
  });

  it('removes a tag added on two offline devices, whichever device removes it', async () => {
    const errand = await tag('@Errand', null, 'a0');
    const taskId = await captured('Collect the parcel');
    // Both devices add the tag; the server keeps the first link and ignores the second.
    await addTag(taskId, errand);
    await addTag(taskId, errand);

    // The second device removes the tag before it has heard about the first link.
    assert.equal(await perform(OperationName.untagTask, { taskId, tagId: errand }), 'applied');

    assert.deepEqual(await tagNames(taskId), []);
  });

  it('refuses a tag or task that does not exist', async () => {
    const real = await tag('Real', null, 'a0');
    const taskId = await captured('Something');

    assert.equal((await addTag(taskId, crypto.randomUUID())).outcome, 'not_found');
    assert.equal((await addTag(crypto.randomUUID(), real)).outcome, 'not_found');
    assert.deepEqual(await tagNames(taskId), []);
  });
});

describe('the Tags perspective', () => {
  async function project(name: string) {
    const projectId = crypto.randomUUID();
    assert.equal(await perform(OperationName.createProject, { projectId, name, kind: 'single_actions', folderId: null, position: 'a0' }), 'applied');
    return projectId;
  }

  let created = 0;
  async function task(projectId: string, title: string, tagIds: string[]) {
    const taskId = crypto.randomUUID();
    const createdAt = new Date(Date.parse('2026-11-13T10:00:00.000Z') + ++created * 1000).toISOString();
    assert.equal(await perform(OperationName.createTask, { taskId, projectId, title, position: 'a0', createdAt }), 'applied');
    for (const tagId of tagIds) assert.equal(await perform(OperationName.tagTask, { taskTagId: crypto.randomUUID(), taskId, tagId }), 'applied');
    return taskId;
  }

  const outline = async (tagId: string) =>
    (await h.application.tagged(tagId)).map(({ tag, tasks }) => ({ [tag.path.join(' : ')]: tasks.map((t) => t.title) }));

  it('shows unfinished tasks from the tag and its descendants, under full-path headings, once per matching tag', async () => {
    const people = await tag('People', null, 'a0');
    const dad = await tag('Dad', people, 'a0');
    const computer = await tag('@Computer', null, 'a1');
    const shallow = await tag('Shallow work', computer, 'a0');
    const lowEnergy = await tag('Low energy', shallow, 'a0');
    const shopping = await tag('Online shopping', shallow, 'a1');
    const deep = await tag('Deep work', computer, 'a2');
    const misc = await project('Miscellaneous');

    await task(misc, 'Order water pick', [shopping]);
    await task(misc, 'Ask Dad about AAA checkup', [dad, lowEnergy]);
    await task(misc, 'Tidy downloads', [shallow, lowEnergy]);
    await task(misc, 'Write the report', [deep]);
    const done = await task(misc, 'Book weightlifting class', [lowEnergy]);
    assert.equal(await perform(OperationName.completeTask, { taskId: done, completedAt: '2026-11-13T11:00:00.000Z' }), 'applied');

    assert.deepEqual(await outline(shallow), [
      { '@Computer : Shallow work': ['Tidy downloads'] },
      { '@Computer : Shallow work : Low energy': ['Ask Dad about AAA checkup', 'Tidy downloads'] },
      { '@Computer : Shallow work : Online shopping': ['Order water pick'] },
    ]);
    assert.deepEqual(await outline(people), [{ 'People : Dad': ['Ask Dad about AAA checkup'] }]);

    // A task keeps all its tags, including those outside the selected branch.
    const [lowEnergyGroup] = (await h.application.tagged(lowEnergy)).map((g) => g.tasks);
    assert.deepEqual(new Set(lowEnergyGroup?.[0]?.tagIds), new Set([dad, lowEnergy]));
  });

  it('adds a task straight to a tag; without a project it also waits in the Inbox', async () => {
    const errand = await tag('@Errand', null, 'a0');
    const taskId = crypto.randomUUID();
    const link = { taskTagId: crypto.randomUUID(), tagId: errand };

    assert.equal(await perform(OperationName.createTask, { taskId, projectId: null, title: 'Buy stamps', position: null, tags: [link] }), 'applied');

    assert.deepEqual(await outline(errand), [{ '@Errand': ['Buy stamps'] }]);
    assert.ok((await h.application.inbox()).some((entry) => entry.id === taskId));
    const [created] = await h.application.history(taskId);
    assert.deepEqual(created?.changes.map((c) => c.entity), ['task', 'task_tag']);
  });

  it('refuses a new task with a missing tag, or with a position but no project, and creates nothing', async () => {
    const real = await tag('Real', null, 'a0');
    const taskId = crypto.randomUUID();
    const missing = { taskTagId: crypto.randomUUID(), tagId: crypto.randomUUID() };

    assert.equal(await perform(OperationName.createTask, { taskId, projectId: null, title: 'Lost', tags: [missing] }), 'not_found');
    assert.equal(await perform(OperationName.createTask, { taskId, projectId: null, title: 'Lost', position: 'a0' }), 'invalid_position');
    assert.equal(await h.application.task(taskId), null);
    assert.deepEqual(await outline(real), []);
  });

  it('shows nothing for a tag without tasks or one that does not exist', async () => {
    const empty = await tag('Empty', null, 'a0');
    assert.deepEqual(await outline(empty), []);
    assert.deepEqual(await outline(crypto.randomUUID()), []);
  });
});
