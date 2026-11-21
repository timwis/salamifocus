import { useQuery } from '@powersync/react';
import { dayIn, forecastHeading, forecastView, ForecastSectionId, type ForecastDates } from '@salamifocus/domain';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNow } from '../clock.ts';
import { Outline, type OutlineGroup, type Relocate } from '../outline/Outline.tsx';
import { taskStateColumns, type TaskState } from '../queries.ts';

interface TaskRow extends TaskState {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string | null;
  project_name: string | null;
}

/** The start of the next day on this device. */
function nextMidnight(now: Date): string {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.toISOString();
}

/** The group a task moved to: of the same kind (Due or Deferred) if it is still shown under one, else wherever it is. */
const relocate: Relocate = ({ taskId, groupId }, groups) => {
  const kind = groupId.slice(groupId.lastIndexOf('/'));
  const holding = groups.filter((g) => g.tasks.some((t) => t.id === taskId));
  return (holding.find((g) => g.id.endsWith(kind)) ?? holding[0])?.id ?? null;
};

/**
 * Forecast: what is overdue, what is due and what is deferred until when, day by day, in the device's time zone. Past, Today
 * (always shown), each of the next days with something on it, then Future, each split into Due and Deferred.
 */
export function ForecastPerspective() {
  // A task being edited keeps its place, and the day it was placed on, until editing stops, so a new date (or
  // midnight) does not move it from under the editor.
  const [held, setHeld] = useState<(ForecastDates & { id: string; at: Date }) | null>(null);
  // Only dated tasks are placed, and the one being edited, which may have just lost its dates.
  const { data: tasks } = useQuery<TaskRow>(
    `SELECT * FROM (
       SELECT t.id, t.title, t.note, t.position, t.created_at, t.project_id, p.name AS project_name, ${taskStateColumns}
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.completed_at IS NULL
     ) WHERE "deferredUntil" IS NOT NULL OR "dueBy" IS NOT NULL OR id = ?
     ORDER BY created_at, id`,
    [held?.id ?? null],
  );
  const latest = useRef(tasks);
  latest.current = tasks;
  const onEditing = useCallback((taskId: string | null) => {
    setHeld((previous) => {
      if (taskId === null) return null;
      if (previous?.id === taskId) return previous;
      const task = latest.current.find((t) => t.id === taskId);
      return task ? { id: task.id, deferredUntil: task.deferredUntil, dueBy: task.dueBy, at: new Date() } : null;
    });
  }, []);

  // The days move on at midnight, with the app left open.
  const now = useNow([nextMidnight(new Date())]);
  const placedAt = held?.at ?? now;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayIn(placedAt, timeZone);
  // Placement depends on the clock only through the day, so it is worked out again only when that changes.
  const sections = useMemo(
    () => forecastView(tasks, (task) => (task.id === held?.id ? held : task), placedAt, timeZone),
    [tasks, held, today, timeZone],
  );
  const asRows = (rows: TaskRow[]) => rows.map((task) => ({ ...task, projectId: task.project_id, projectName: task.project_name }));
  const groups: OutlineGroup[] = sections.flatMap((section) => {
    const heading = forecastHeading(section, today);
    const sectionInfo = { id: section.id, heading, empty: section.id === ForecastSectionId.today ? 'Nothing is due or deferred until today.' : undefined };
    // On a day, the date that placed a task there shows as just its time.
    const onDay = section.day !== null;
    return [
      { id: `${section.id}/due`, heading: 'Due', ordered: false, section: sectionInfo, datedBy: onDay ? ('due' as const) : undefined, tasks: asRows(section.due) },
      { id: `${section.id}/deferred`, heading: 'Deferred', ordered: false, section: sectionInfo, datedBy: onDay ? ('defer' as const) : undefined, tasks: asRows(section.deferred) },
    ];
  });
  const overdue = sections.find((s) => s.id === ForecastSectionId.past)?.due.length ?? 0;
  const dueToday = sections.find((s) => s.id === ForecastSectionId.today)?.due.length ?? 0;

  return (
    <Outline
      title="Forecast"
      summary={`${overdue} overdue, ${dueToday} due today`}
      groups={groups}
      empty={null}
      onEditing={onEditing}
      relocate={relocate}
    />
  );
}
