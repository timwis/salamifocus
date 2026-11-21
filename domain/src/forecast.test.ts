import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, dayIn, forecastHeading } from './forecast.ts';

test('a day is the calendar day in the given time zone, not UTC', () => {
  assert.equal(dayIn('2026-11-16T23:30:00.000Z', 'Europe/London'), '2026-11-16');
  assert.equal(dayIn('2026-11-16T23:30:00.000Z', 'Europe/Berlin'), '2026-11-17');
  assert.equal(dayIn('2026-11-17T03:00:00.000Z', 'America/New_York'), '2026-11-16');
});

test('days are counted across month and year ends, and clock changes', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2027-03-27', 2), '2027-03-29');
});

test('headings name today and tomorrow, then the day and date', () => {
  const today = '2026-11-16';
  assert.equal(forecastHeading({ id: 'past', day: null }, today), 'Past');
  assert.equal(forecastHeading({ id: 'today', day: today }, today), 'Today');
  assert.equal(forecastHeading({ id: '2026-11-17', day: '2026-11-17' }, today), 'Tomorrow');
  assert.equal(forecastHeading({ id: '2026-11-18', day: '2026-11-18' }, today), 'Wed 18 Nov');
  assert.equal(forecastHeading({ id: 'future', day: null }, today), 'Future');
});
