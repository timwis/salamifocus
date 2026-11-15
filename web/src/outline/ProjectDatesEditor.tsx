import { useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { deferProject, setProjectDue } from '../writes.ts';
import { DateField, useDateFields } from './DateField.tsx';

export interface DatedProject {
  id: string;
  deferUntil: string | null;
  dueAt: string | null;
}

type DateFieldName = 'defer' | 'due';

const fieldOrder: DateFieldName[] = ['defer', 'due'];

const dateFields: Record<DateFieldName, { label: string; placeholder: string; write: (projectId: string, value: string | null) => Promise<void> }> = {
  defer: { label: 'Defer project until', placeholder: 'Defer', write: deferProject },
  due: { label: 'Project due', placeholder: 'Due', write: setProjectDue },
};

/**
 * Edits a project's defer and due dates in place, under its heading. Each date is saved when the user leaves
 * its field; Enter or focus moving elsewhere closes the editor, and Escape abandons the field being edited.
 */
export function ProjectDatesEditor({ project, onClose }: { project: DatedProject; onClose: () => void }) {
  const dates = useDateFields({ defer: project.deferUntil, due: project.dueAt }, (field, value) => void dateFields[field].write(project.id, value));
  const container = useRef<HTMLDivElement>(null);
  const fields = { defer: useRef<HTMLInputElement>(null), due: useRef<HTMLInputElement>(null) };
  const closed = useRef(false);

  useLayoutEffect(() => fields.defer.current?.focus(), []);

  // If the editor goes away without closing (its project vanished in a sync), keep what was typed.
  useEffect(
    () => () => {
      if (!closed.current) fieldOrder.forEach(dates.save);
    },
    // save reads refs only, so the first render's copy stays correct.
    [],
  );

  function close(abandon?: DateFieldName) {
    if (closed.current) return;
    closed.current = true;
    for (const field of fieldOrder) if (field !== abandon) dates.save(field);
    onClose();
  }

  function onKeyDown(field: DateFieldName, event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') return close(field);
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    if (dates.invalid(field)) return;
    if (event.key === 'Enter') return close();
    dates.save(field);
    fields[fieldOrder[(fieldOrder.indexOf(field) + 1) % fieldOrder.length]!].current?.focus();
  }

  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && container.current?.contains(next)) return;
    close();
  }

  return (
    <div className="project-dates-editor" ref={container} onBlur={onBlur} onClick={(event) => event.stopPropagation()}>
      {fieldOrder.map((field) => (
        <DateField
          key={field}
          kind={field}
          label={dateFields[field].label}
          placeholder={dateFields[field].placeholder}
          text={dates.text[field]}
          initialText={dates.shownText(field)}
          inputRef={fields[field]}
          onChange={(text) => dates.change(field, text)}
          onKeyDown={(event) => onKeyDown(field, event)}
        />
      ))}
    </div>
  );
}
