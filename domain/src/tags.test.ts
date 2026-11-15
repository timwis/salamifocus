import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTagTree, groupByTag, placedTags, tagBranch, type TagNode, type TagRecord } from './tags.ts';

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

test('a tag’s branch is the tag and everything beneath it', () => {
  const tree = buildTagTree(tags);
  assert.deepEqual(tagBranch(tree, 'shallow').map((p) => p.tag.id), ['shallow', 'low-energy']);
  assert.deepEqual(tagBranch(tree, 'missing'), []);
});

test('selecting a tag groups tasks under each matching tag in its branch, skipping empty groups', () => {
  const tasks = [
    { id: 'water pick', tags: ['low-energy'] },
    { id: 'tidy inbox', tags: ['shallow', 'low-energy', 'people'] },
    { id: 'write report', tags: ['deep'] },
    { id: 'call mum', tags: ['people'] },
  ];
  const groups = groupByTag(tagBranch(buildTagTree(tags), 'computer'), tasks, (t) => t.tags);

  assert.deepEqual(
    groups.map((g) => [g.path.join(' : '), g.tasks.map((t) => t.id)]),
    [
      ['computer : deep', ['write report']],
      ['computer : shallow', ['tidy inbox']],
      ['computer : shallow : low-energy', ['water pick', 'tidy inbox']],
    ],
  );
});
