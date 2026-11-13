import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { OperationName, type OrganisationNode } from '@salamifocus/domain';
import { createHarness, request, type Harness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await createHarness();
});
after(() => h.close());
beforeEach(async () => {
  await h.sql`TRUNCATE folders, projects CASCADE`;
});

async function perform(name: string, args: Record<string, unknown>) {
  const result = await h.application.execute(request(name, args));
  return result.outcome === 'applied' ? 'applied' : result.code;
}

async function folder(name: string, parentId: string | null, position: string) {
  const folderId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createFolder, { folderId, name, parentId, position }), 'applied');
  return folderId;
}

async function project(name: string, folderId: string | null, position: string, kind = 'project') {
  const projectId = crypto.randomUUID();
  assert.equal(await perform(OperationName.createProject, { projectId, name, kind, folderId, position }), 'applied');
  return projectId;
}

/** The sidebar as names, so assertions read like the screen. */
const outline = (nodes: OrganisationNode[]): unknown[] =>
  nodes.map((n) => (n.type === 'folder' ? { [n.name]: outline(n.children) } : n.kind === 'single_actions' ? `${n.name} (single actions)` : n.name));

const sidebar = async () => outline(await h.application.organisation());

describe('organising folders and projects', () => {
  it('nests folders, projects and single-action lists to any depth, in the order given', async () => {
    const personal = await folder('Personal', null, 'a0');
    await folder('Work', null, 'a1');
    await project('Miscellaneous', personal, 'a0', 'single_actions');
    const parents = await folder('Parents', personal, 'a1');
    const tax = await folder('Tax negotiation', parents, 'a0');
    await project('Large St sold', tax, 'a0');
    await project('Irish passport renewed', personal, 'a2');

    assert.deepEqual(await sidebar(), [
      {
        Personal: [
          'Miscellaneous (single actions)',
          { Parents: [{ 'Tax negotiation': ['Large St sold'] }] },
          'Irish passport renewed',
        ],
      },
      { Work: [] },
    ]);
  });

  it('refers to folders by identity, so same-named folders stay distinct and renaming keeps contents', async () => {
    const first = await folder('Admin', null, 'a0');
    const second = await folder('Admin', null, 'a1');
    await project('Renew car insurance', second, 'a0');

    assert.equal(await perform(OperationName.renameFolder, { folderId: second, name: '  Household admin ' }), 'applied');

    assert.deepEqual(await sidebar(), [{ Admin: [] }, { 'Household admin': ['Renew car insurance'] }]);
    assert.notEqual(first, second);
  });

  it('renames projects and refuses blank names', async () => {
    const id = await project('Holiday', null, 'a0');

    assert.equal(await perform(OperationName.renameProject, { projectId: id, name: 'Summer holiday booked' }), 'applied');
    assert.equal(await perform(OperationName.renameProject, { projectId: id, name: '   ' }), 'invalid_name');
    assert.equal(await perform(OperationName.createFolder, { folderId: crypto.randomUUID(), name: '', parentId: null, position: 'a1' }), 'invalid_name');

    assert.deepEqual(await sidebar(), ['Summer holiday booked']);
  });

  it('reorders an item among its siblings without moving it out of its folder', async () => {
    const home = await folder('Home', null, 'a0');
    await project('Garden', home, 'a0');
    const kitchen = await project('Kitchen', home, 'a1');

    assert.equal(await perform(OperationName.moveProject, { projectId: kitchen, position: 'Zz' }), 'applied');

    assert.deepEqual(await sidebar(), [{ Home: ['Kitchen', 'Garden'] }]);
  });

  it('moves projects and folders between folders and to the top level', async () => {
    const personal = await folder('Personal', null, 'a0');
    const work = await folder('Work', null, 'a1');
    const someday = await folder('Someday', personal, 'a0');
    const books = await project('Books', null, 'a2');

    assert.equal(await perform(OperationName.moveProject, { projectId: books, folderId: someday, position: 'a0' }), 'applied');
    assert.equal(await perform(OperationName.moveFolder, { folderId: someday, parentId: work, position: 'a0' }), 'applied');
    assert.equal(await perform(OperationName.moveFolder, { folderId: personal, parentId: null, position: 'a2' }), 'applied');

    assert.deepEqual(await sidebar(), [{ Work: [{ Someday: ['Books'] }] }, { Personal: [] }]);
  });

  it('refuses to put a folder inside itself or one of its descendants', async () => {
    const outer = await folder('Outer', null, 'a0');
    const middle = await folder('Middle', outer, 'a0');
    const inner = await folder('Inner', middle, 'a0');

    assert.equal(await perform(OperationName.moveFolder, { folderId: outer, parentId: inner, position: 'a0' }), 'would_nest_in_itself');
    assert.equal(await perform(OperationName.moveFolder, { folderId: outer, parentId: outer, position: 'a0' }), 'would_nest_in_itself');

    assert.deepEqual(await sidebar(), [{ Outer: [{ Middle: [{ Inner: [] }] }] }]);
  });

  it('refuses to put anything in a folder that does not exist', async () => {
    const missing = crypto.randomUUID();
    const id = await project('Orphan', null, 'a0');

    assert.equal(await perform(OperationName.moveProject, { projectId: id, folderId: missing, position: 'a0' }), 'not_found');
    assert.equal(
      await perform(OperationName.createProject, { projectId: crypto.randomUUID(), name: 'Lost', kind: 'project', folderId: missing, position: 'a1' }),
      'not_found',
    );
    assert.deepEqual(await sidebar(), ['Orphan']);
  });

  it('refuses malformed positions, unknown kinds and reused ids', async () => {
    const id = await project('Taxes', null, 'a0');

    assert.equal(await perform(OperationName.moveProject, { projectId: id, position: 'not a key' }), 'invalid_position');
    assert.equal(
      await perform(OperationName.createProject, { projectId: crypto.randomUUID(), name: 'X', kind: 'sequential', folderId: null, position: 'a1' }),
      'invalid_arguments',
    );
    assert.equal(
      await perform(OperationName.createProject, { projectId: id, name: 'Impostor', kind: 'project', folderId: null, position: 'a1' }),
      'already_exists',
    );
    assert.deepEqual(await sidebar(), ['Taxes']);
  });
});
