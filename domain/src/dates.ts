import * as chrono from 'chrono-node';

// Defer and due dates are stored as instants (UTC ISO strings). What the user
// types is read in the device's own time zone at the moment of entry.

export type DateKind = 'defer' | 'due';

/** The hour a date typed without a time stands for: the start of the day to defer, 17:00 for a deadline (as OmniFocus does). */
export const defaultHour: Record<DateKind, number> = { defer: 0, due: 17 };

export type DateEntry = { kind: 'empty' } | { kind: 'date'; date: Date } | { kind: 'invalid' };

// Day/month order, as in "1/12" for the 1st of December.
const parser = chrono.en.GB;

// chrono reads "1m" as a minute; here it is a month, alongside 3d, 2w and 1y.
const shortMonths = /^(\d+)\s*m$/i;

/**
 * Reads a typed date: a count of days, weeks, months or years from today ("1 week", "3d", "2w", "1m", "1y"),
 * today or tomorrow, a weekday ("fri", "next friday"), or an explicit date, each with an optional time. Empty
 * text clears the date. Anything not wholly a date is invalid.
 */
export function readDateEntry(text: string, kind: DateKind, now: Date): DateEntry {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  const input = trimmed.replace(shortMonths, '$1 months');
  const result = parseWhole(input, now);
  if (!result) return { kind: 'invalid' };
  if (result.start.isCertain('hour')) return { kind: 'date', date: result.start.date() };
  // chrono takes a date without a time to mean midday, so after midday it would move today's own date
  // ("16 Nov", "mon") on a year or a week. Read from the start of today, it stays today.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const fromToday = parseWhole(input, startOfToday)?.start.date();
  const date = fromToday && sameDay(fromToday, now) ? fromToday : result.start.date();
  date.setHours(defaultHour[kind], 0, 0, 0);
  return { kind: 'date', date };
}

/** The one date that the whole of the text is, read forwards from `reference`, or null. */
function parseWhole(input: string, reference: Date) {
  const [result, ...rest] = parser.parse(input, reference, { forwardDate: true });
  return result && rest.length === 0 && result.index === 0 && result.text.length === input.length ? result : null;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function describeDay(date: Date, now: Date, options: { year?: boolean }): string {
  const parts = Object.fromEntries(dayFormat.formatToParts(date).map((part) => [part.type, part.value]));
  const withYear = options.year || date.getFullYear() !== now.getFullYear();
  return [parts.weekday, parts.day, parts.month, ...(withYear ? [parts.year] : [])].join(' ');
}

/**
 * A date as the user reads it in their own time zone, such as "Mon 23 Nov", with the year when it is not
 * this year's (or always, with `year`), and the time when it is not the kind's usual hour.
 */
export function describeDate(value: string | Date, kind: DateKind, now: Date, options: { year?: boolean } = {}): string {
  const date = new Date(value);
  const day = describeDay(date, now, options);
  const usual = date.getHours() === defaultHour[kind] && date.getMinutes() === 0;
  return usual ? day : `${day} ${timeFormat.format(date)}`;
}

/** Just the time of a date, such as "17:00", where the day is already shown. */
export function describeTime(value: string | Date): string {
  return timeFormat.format(new Date(value));
}

/** Whether a due date has arrived: a task due at 17:00 is overdue from 17:00, as a deferred one is available from its date. */
export function isOverdue(due: string | Date, now: Date): boolean {
  return new Date(due).getTime() <= now.getTime();
}

/** When something happened, such as a task's completion, always with its time: "Sat 14 Nov 15:30". */
export function describeMoment(value: string | Date, now: Date): string {
  const date = new Date(value);
  return `${describeDay(date, now, {})} ${timeFormat.format(date)}`;
}
