import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePositions, positionAt, positionProblem, type Positioned } from './positions.ts';

const sorted = (items: Positioned[]) => [...items].sort(comparePositions).map((i) => i.id);

test('a position can be placed before, between and after siblings', () => {
  const first = { id: 'first', position: positionAt([], 0) };
  const last = { id: 'last', position: positionAt([first], 1) };
  const middle = { id: 'middle', position: positionAt([first, last], 1) };
  const front = { id: 'front', position: positionAt([first, middle, last], 0) };

  assert.deepEqual(sorted([last, middle, front, first]), ['front', 'first', 'middle', 'last']);
});

test('siblings that share a position from two offline devices still leave room to insert', () => {
  const a = { id: 'a', position: 'a1' };
  const b = { id: 'b', position: 'a1' };
  const c = { id: 'c', position: 'a2' };
  const inserted = { id: 'x', position: positionAt([a, b, c], 1) };

  assert.deepEqual(sorted([c, inserted, b, a]), ['a', 'b', 'x', 'c']);
});

test('items without a position sort after those with one', () => {
  assert.deepEqual(sorted([{ id: 'unplaced', position: null }, { id: 'placed', position: 'a0' }]), ['placed', 'unplaced']);
});

test('only well-formed sort keys are accepted', () => {
  assert.equal(positionProblem('a0'), null);
  assert.notEqual(positionProblem(''), null);
  assert.notEqual(positionProblem('a10'), null);
  assert.notEqual(positionProblem('!'), null);
  for (const malformed of ['a0!', 'a0 ', 'a0~x', 'a1é']) assert.notEqual(positionProblem(malformed), null, malformed);
});
