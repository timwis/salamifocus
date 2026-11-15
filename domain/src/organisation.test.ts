import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTree, placedFolders, placedProjects, projectsInSelection, wouldNestInItself, type FolderRecord, type OrganisationNode, type ProjectRecord } from './organisation.ts';

const folder = (id: string, parentId: string | null, position: string): FolderRecord => ({ id, name: id, parentId, position });
const project = (id: string, folderId: string | null, position: string): ProjectRecord => ({
  id,
  name: id,
  folderId,
  position,
  kind: 'project',
});

const outline = (nodes: OrganisationNode[]): unknown[] =>
  nodes.map((n) => (n.type === 'folder' ? { [n.id]: outline(n.children) } : n.id));

const folders = [folder('personal', null, 'a0'), folder('parents', 'personal', 'a2'), folder('work', null, 'a1')];
const projects = [
  project('miscellaneous', 'personal', 'a1'),
  project('tax', 'parents', 'a0'),
  project('passport', 'personal', 'a3'),
  project('work-misc', 'work', 'a0'),
];

test('folders and projects nest in sibling order, interleaved', () => {
  assert.deepEqual(outline(buildTree(folders, projects)), [
    { personal: ['miscellaneous', { parents: ['tax'] }, 'passport'] },
    { work: ['work-misc'] },
  ]);
});

test('nothing is hidden when its folder is missing or folders form a cycle', () => {
  const tree = buildTree([folder('x', 'y', 'a0'), folder('y', 'x', 'a1')], [project('lost', 'gone', 'a0')]);
  assert.deepEqual(outline(tree), ['lost', { x: [{ y: [] }] }]);
});

test('selecting a folder covers every project inside it, once, in sidebar order', () => {
  const tree = buildTree(folders, projects);
  const ids = (selected: string[]) => projectsInSelection(tree, selected).map((p) => p.id);

  assert.deepEqual(ids(['personal', 'tax']), ['miscellaneous', 'tax', 'passport']);
  assert.deepEqual(ids(['work-misc', 'parents']), ['tax', 'work-misc']);
});

test('a folder cannot be put inside itself or its descendants', () => {
  const parentOf = (id: string) => folders.find((f) => f.id === id)?.parentId;
  assert.equal(wouldNestInItself('personal', 'parents', parentOf), true);
  assert.equal(wouldNestInItself('personal', 'personal', parentOf), true);
  assert.equal(wouldNestInItself('parents', 'work', parentOf), false);
  assert.equal(wouldNestInItself('parents', null, parentOf), false);
});

test('every project knows the folders it is in, in sidebar order', () => {
  assert.deepEqual(
    placedProjects(buildTree(folders, projects)).map((p) => p.path.join(' : ')),
    ['personal : miscellaneous', 'personal : parents : tax', 'personal : passport', 'work : work-misc'],
  );
});

test('every folder knows its full path, and comes before the folders inside it', () => {
  assert.deepEqual(
    placedFolders(buildTree(folders, projects)).map((p) => p.path.join(' : ')),
    ['personal', 'personal : parents', 'work'],
  );
});
