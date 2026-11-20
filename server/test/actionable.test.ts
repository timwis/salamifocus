import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FolderScope, OperationName } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

// What Actionable shows is pinned down by fixtures/actionable.json; these cover designating its folders.

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

const designate = (scope: string, folderId: string | null) => perform(OperationName.designateFolder, { scope, folderId });

describe('designated folders', () => {
  it('starts with no folder designated, and nothing to show', async () => {
    assert.deepEqual((await h.application.settings()).folders, { personal: null, work: null });
    assert.deepEqual(await h.application.actionable(FolderScope.work), { folderId: null, groups: [] });
  });

  it('keeps each scope’s folder by identity, so renaming or moving it keeps it designated', async () => {
    const personal = await folder('Personal');
    const work = await folder('Work');
    assert.equal(await designate('personal', personal), 'applied');
    assert.equal(await designate('work', work), 'applied');
    const life = await folder('Life');
    assert.equal(await perform(OperationName.renameFolder, { folderId: personal, name: 'Home life' }), 'applied');
    assert.equal(await perform(OperationName.moveFolder, { folderId: personal, parentId: life, position: 'a0' }), 'applied');

    assert.deepEqual((await h.application.settings()).folders, { personal, work });
    assert.equal(await designate('work', null), 'applied');
    assert.deepEqual((await h.application.settings()).folders, { personal, work: null });
  });

  it('refuses an unknown scope or a folder that does not exist', async () => {
    assert.equal(await designate('hobbies', await folder('Hobbies')), 'invalid_arguments');
    assert.equal(await designate('personal', crypto.randomUUID()), 'not_found');
    assert.equal(await perform(OperationName.designateFolder, { scope: 'personal' }), 'invalid_arguments');
  });
});
