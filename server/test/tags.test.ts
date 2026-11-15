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

    assert.equal(await perform(OperationName.untagTask, { taskTagId }), 'applied');
    assert.equal(await perform(OperationName.untagTask, { taskTagId }), 'applied');

    assert.deepEqual(await tagNames(taskId), ['@Flat']);
    const removals = (await h.application.history(taskId)).filter((entry) => entry.operation === OperationName.untagTask);
    assert.deepEqual(
      removals.map((entry) => entry.changes),
      [[{ entity: 'task_tag', entityId: taskTagId, kind: 'delete', before: { task_id: taskId, tag_id: phone }, after: null }]],
    );
  });

  it('refuses a tag or task that does not exist', async () => {
    const real = await tag('Real', null, 'a0');
    const taskId = await captured('Something');

    assert.equal((await addTag(taskId, crypto.randomUUID())).outcome, 'not_found');
    assert.equal((await addTag(crypto.randomUUID(), real)).outcome, 'not_found');
    assert.deepEqual(await tagNames(taskId), []);
  });
});
