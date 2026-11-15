import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDate, readDateEntry, type DateKind } from './dates.ts';

// Run with TZ=Europe/London (see package.json), so local times are predictable.
const monday = new Date('2026-11-16T09:30:00.000Z');

function read(text: string, kind: DateKind = 'defer') {
  const entry = readDateEntry(text, kind, monday);
  return entry.kind === 'date' ? describeDate(entry.date, kind, monday, { year: true }) : entry.kind;
}

test('a count of days, weeks, months or years is counted from today, short forms included', () => {
  assert.equal(read('1 week'), 'Mon 23 Nov 2026');
  assert.equal(read('3 days'), 'Thu 19 Nov 2026');
  assert.equal(read('3d'), 'Thu 19 Nov 2026');
  assert.equal(read('2w'), 'Mon 30 Nov 2026');
  assert.equal(read('1m'), 'Wed 16 Dec 2026');
  assert.equal(read('1 month'), 'Wed 16 Dec 2026');
  assert.equal(read('1y'), 'Tue 16 Nov 2027');
});

test('today, tomorrow, weekdays and explicit dates are understood', () => {
  assert.equal(read('today'), 'Mon 16 Nov 2026');
  assert.equal(read('tomorrow'), 'Tue 17 Nov 2026');
  assert.equal(read('fri'), 'Fri 20 Nov 2026');
  assert.equal(read('next friday'), 'Fri 27 Nov 2026');
  assert.equal(read('1 Dec'), 'Tue 1 Dec 2026');
  assert.equal(read('1/12'), 'Tue 1 Dec 2026');
  assert.equal(read('2027-01-04'), 'Mon 4 Jan 2027');
  assert.equal(read('  Mon 23 Nov 2026  '), 'Mon 23 Nov 2026');
});

test('a date without a time means the start of the day to defer, and 17:00 when due', () => {
  const defer = readDateEntry('tomorrow', 'defer', monday);
  const due = readDateEntry('tomorrow', 'due', monday);
  assert.equal(defer.kind === 'date' && defer.date.toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(due.kind === 'date' && due.date.toISOString(), '2026-11-17T17:00:00.000Z');
});

test('a time typed with the date is kept, and shown when it is not the usual hour', () => {
  assert.equal(read('tomorrow 9am'), 'Tue 17 Nov 2026 09:00');
  assert.equal(read('1 Dec 2026 17:00', 'due'), 'Tue 1 Dec 2026');
  assert.equal(read('1 Dec 2026 17:00', 'defer'), 'Tue 1 Dec 2026 17:00');
});

test('empty text clears the date, and anything that is not wholly a date is invalid', () => {
  assert.equal(read('   '), 'empty');
  assert.equal(read('banana'), 'invalid');
  assert.equal(read('banana tomorrow'), 'invalid');
  assert.equal(read('tomorrow or friday'), 'invalid');
});

test('dates are described in local time, with the year only when it is not this one', () => {
  assert.equal(describeDate('2026-11-23T00:00:00.000Z', 'defer', monday), 'Mon 23 Nov');
  assert.equal(describeDate('2027-01-04T00:00:00.000Z', 'defer', monday), 'Mon 4 Jan 2027');
  // British Summer Time: midnight in London is 23:00 the day before in UTC.
  assert.equal(describeDate('2027-06-30T23:00:00.000Z', 'defer', monday), 'Thu 1 Jul 2027');
  assert.equal(describeDate('2026-11-23T17:00:00.000Z', 'defer', monday), 'Mon 23 Nov 17:00');
});

test("today's own date or weekday means today, even late in the day", () => {
  const afternoon = new Date('2026-11-16T13:30:00.000Z');
  const readAt = (text: string, kind: DateKind) => {
    const entry = readDateEntry(text, kind, afternoon);
    return entry.kind === 'date' ? describeDate(entry.date, kind, afternoon, { year: true }) : entry.kind;
  };
  for (const kind of ['defer', 'due'] as const) {
    assert.equal(readAt('16 Nov', kind), 'Mon 16 Nov 2026');
    assert.equal(readAt('16/11', kind), 'Mon 16 Nov 2026');
    assert.equal(readAt('mon', kind), 'Mon 16 Nov 2026');
    assert.equal(readAt('today', kind), 'Mon 16 Nov 2026');
    assert.equal(readAt('tomorrow', kind), 'Tue 17 Nov 2026');
    assert.equal(readAt('1 week', kind), 'Mon 23 Nov 2026');
    assert.equal(readAt('next monday', kind), 'Mon 23 Nov 2026');
    assert.equal(readAt('15 Nov', kind), 'Mon 15 Nov 2027');
  }
  // A time typed for later today stays today; one already past moves on a day.
  assert.equal(readAt('5pm', 'defer'), 'Mon 16 Nov 2026 17:00');
  assert.equal(readAt('9am', 'defer'), 'Tue 17 Nov 2026 09:00');
});
