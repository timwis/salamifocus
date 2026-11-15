import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTagTree, placedTags, type TagNode, type TagRecord } from './tags.ts';

const tag = (id: string, parentId: string | null, position: string): TagRecord => ({ id, name: id, parentId, position });

const outline = (nodes: TagNode[]): unknown[] => nodes.map((n) => (n.children.length > 0 ? { [n.id]: outline(n.children) } : n.id));

const tags = [
  tag('computer', null, 'a1'),
  tag('people', null, 'a0'),
  tag('shallow', 'computer', 'a1'),
  tag('deep', 'computer', 'a0'),
  tag('low-energy', 'shallow', 'a0'),
];

test('tags nest in sibling order', () => {
  assert.deepEqual(outline(buildTagTree(tags)), ['people', { computer: ['deep', { shallow: ['low-energy'] }] }]);
});

test('no tag is hidden when its parent is missing or tags form a cycle', () => {
  const tree = buildTagTree([tag('x', 'y', 'a1'), tag('y', 'x', 'a2'), tag('lost', 'gone', 'a0')]);
  assert.deepEqual(outline(tree), ['lost', { x: ['y'] }]);
});

test('every tag knows its full path, and comes before its descendants', () => {
  assert.deepEqual(
    placedTags(buildTagTree(tags)).map((p) => p.path.join(' : ')),
    ['people', 'computer', 'computer : deep', 'computer : shallow', 'computer : shallow : low-energy'],
  );
});
