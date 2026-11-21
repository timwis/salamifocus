import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { OperationName } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

// What Agendas shows is pinned down by fixtures/agendas.json; these cover designating the People tag.

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function tag(name: string, parentId: string | null = null) {
  const tagId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createTag, { tagId, name, parentId, position: 'a0' }), 'applied');
  return tagId;
}

const designate = (tagId: unknown) => perform(OperationName.designatePeopleTag, { tagId });

describe('the People tag', () => {
  it('starts undesignated, with nothing on any agenda', async () => {
    const people = await tag('People');
    const steve = await tag('Steve', people);
    const taskId = crypto.randomUUID();
    assert.equal(await perform(OperationName.createTask, { taskId, projectId: null, title: 'Ask Steve about lunch', position: null, tags: [{ taskTagId: crypto.randomUUID(), tagId: steve }] }), 'applied');

    assert.equal((await h.application.settings()).peopleTagId, null);
    assert.deepEqual(await h.application.agendas(), []);
    assert.equal(await designate(people), 'applied');
    assert.deepEqual(
      (await h.application.agendas()).map(({ tag, tasks }) => [tag.path, tasks.map((t) => t.id)]),
      [[['Steve'], [taskId]]],
    );
  });

  it('is held by identity, so renaming or moving it keeps it designated', async () => {
    const people = await tag('People');
    const contacts = await tag('Contacts');
    assert.equal(await designate(people), 'applied');
    assert.equal(await perform(OperationName.renameTag, { tagId: people, name: 'Humans' }), 'applied');
    assert.equal(await perform(OperationName.moveTag, { tagId: people, parentId: contacts, position: 'a0' }), 'applied');

    assert.equal((await h.application.settings()).peopleTagId, people);
    assert.equal(await designate(null), 'applied');
    assert.equal((await h.application.settings()).peopleTagId, null);
  });

  it('refuses a tag that does not exist, or no tag at all', async () => {
    assert.equal(await designate(crypto.randomUUID()), 'not_found');
    assert.equal(await perform(OperationName.designatePeopleTag, {}), 'invalid_arguments');
    assert.equal(await designate('Steve'), 'invalid_arguments');
  });
});
