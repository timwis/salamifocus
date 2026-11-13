import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureProblem, titleFromCapture, titleProblem } from './titles.ts';

test('a capture becomes a title without surrounding whitespace', () => {
  assert.equal(titleFromCapture('  Buy oat milk \n'), 'Buy oat milk');
});

test('blank titles and captures are refused', () => {
  assert.notEqual(titleProblem('   '), null);
  assert.notEqual(captureProblem('\n'), null);
  assert.equal(titleProblem('Call Sam'), null);
});
