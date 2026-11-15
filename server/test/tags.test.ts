import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { OperationName, type TagNode } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

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
