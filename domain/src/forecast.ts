// Forecast places unfinished tasks on days by their effective (inherited) defer
// and due dates: what is overdue, what is due and what is deferred until when. Days are
// calendar days in a time zone (the device's, on a client), so placement is
// worked out from the clock each time, and moves on by itself at midnight.

/** How many days after today get a heading of their own; later dates go under Future. */
export const forecastDays = 14;

export const ForecastSectionId = { past: 'past', today: 'today', future: 'future' } as const;

export type ForecastDateKind = 'due' | 'deferred';

export interface ForecastSection<T> {
  /** `past`, `today`, `future`, or a day's date (YYYY-MM-DD) for each of the next days with something on it. */
  id: string;
  /** The day the section is for (YYYY-MM-DD); null for Past and Future, which span many days. */
  day: string | null;
  /** Tasks placed here by their due date, earliest first. */
  due: T[];
  /** Tasks placed here by their defer date, earliest first. */
  deferred: T[];
}

export interface ForecastDates {
  /** The latest defer date among the task, the unfinished tasks it is beneath and its project. */
  deferredUntil: string | null;
  /** The earliest due date among the task, the unfinished tasks it is beneath and its project. */
  dueBy: string | null;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function dayIn(instant: string | Date, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormats.set(timeZone, format);
  }
  // Built from the parts, since a locale's own date pattern can change between runtimes.
  const part = Object.fromEntries(format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day}`;
}

/** The day a number of days after another (YYYY-MM-DD). */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

const headingFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** A section's heading: "Past", "Today", "Tomorrow", "Wed 18 Nov" or "Future". */
export function forecastHeading(section: Pick<ForecastSection<unknown>, 'id' | 'day'>, today: string): string {
  if (section.id === ForecastSectionId.past) return 'Past';
  if (section.id === ForecastSectionId.today) return 'Today';
  if (section.id === ForecastSectionId.future || section.day === null) return 'Future';
  if (section.day === addDays(today, 1)) return 'Tomorrow';
  return headingFormat.format(new Date(`${section.day}T00:00:00Z`));
}

/**
 * What Forecast shows for these unfinished tasks at `now` in `timeZone`: Past (due before today), Today (always,
 * even when empty), a section for each of the next `forecastDays` days that has a due or defer date falling on
 * it, then Future for everything later. Each splits into Due and Deferred, each earliest first (then in the order
 * given). A task appears wherever one of its dates falls; when both fall on the same day, once, under Due. A defer
 * date before today places nothing, since the task is no longer deferred.
 */
export function forecastView<T>(tasks: readonly T[], datesOf: (task: T) => ForecastDates, now: Date, timeZone: string): ForecastSection<T>[] {
  const today = dayIn(now, timeZone);
  const lastDay = addDays(today, forecastDays);
  const sectionOf = (day: string) => (day < today ? ForecastSectionId.past : day === today ? ForecastSectionId.today : day > lastDay ? ForecastSectionId.future : day);

  const placed: { section: string; kind: ForecastDateKind; at: number; order: number; task: T }[] = [];
  tasks.forEach((task, order) => {
    const { deferredUntil, dueBy } = datesOf(task);
    let dueDay: string | null = null;
    if (dueBy !== null) {
      dueDay = dayIn(dueBy, timeZone);
      placed.push({ section: sectionOf(dueDay), kind: 'due', at: Date.parse(dueBy), order, task });
    }
    if (deferredUntil === null) return;
    const deferDay = dayIn(deferredUntil, timeZone);
    if (deferDay >= today && deferDay !== dueDay) placed.push({ section: sectionOf(deferDay), kind: 'deferred', at: Date.parse(deferredUntil), order, task });
  });
  placed.sort((a, b) => a.at - b.at || a.order - b.order);

  const sections = new Map<string, ForecastSection<T>>();
  const sectionFor = (id: string) => {
    let section = sections.get(id);
    if (!section) {
      section = { id, day: id === ForecastSectionId.past || id === ForecastSectionId.future ? null : id === ForecastSectionId.today ? today : id, due: [], deferred: [] };
      sections.set(id, section);
    }
    return section;
  };
  sectionFor(ForecastSectionId.today);
  for (const { section, kind, task } of placed) sectionFor(section)[kind].push(task);

  const rank = (id: string) => (id === ForecastSectionId.past ? 0 : id === ForecastSectionId.today ? 1 : id === ForecastSectionId.future ? 3 : 2);
  return [...sections.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
