import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { deferProject, setProjectDue } from '../writes.ts';
import { DateField, dateFieldMeaning, dateText, sameTime } from './DateField.tsx';

export interface DatedProject {
  id: string;
  deferUntil: string | null;
  dueAt: string | null;
}

type DateFieldName = 'defer' | 'due';

const fieldOrder: DateFieldName[] = ['defer', 'due'];

const dateFields: Record<DateFieldName, { label: string; write: (projectId: string, value: string | null) => Promise<void> }> = {
  defer: { label: 'Defer project until', write: deferProject },
  due: { label: 'Project due', write: setProjectDue },
};

/**
 * Edits a project's defer and due dates in place, under its heading. Each date is saved when the user leaves
 * its field; Enter or focus moving elsewhere closes the editor, and Escape abandons the field being edited.
 */
export function ProjectDatesEditor({ project, onClose }: { project: DatedProject; onClose: () => void }) {
  const [dates, setDates] = useState<Record<DateFieldName, string>>(() => ({
    defer: dateText(project.deferUntil, 'defer'),
    due: dateText(project.dueAt, 'due'),
  }));
  const container = useRef<HTMLDivElement>(null);
  const fields = { defer: useRef<HTMLInputElement>(null), due: useRef<HTMLInputElement>(null) };
  const typed = useRef({ ...dates });
  const shown = useRef({ ...dates });
  const saved = useRef<Record<DateFieldName, string | null>>({ defer: project.deferUntil, due: project.dueAt });
  const closed = useRef(false);

  useLayoutEffect(() => fields.defer.current?.focus(), []);

  useEffect(
    () => () => {
      if (!closed.current) fieldOrder.forEach(save);
    },
    [],
  );

  const meaning = (field: DateFieldName) => dateFieldMeaning(typed.current[field], shown.current[field], field);

  function save(field: DateFieldName) {
    const read = meaning(field);
    if (read.kind !== 'date') return;
    const text = dateText(read.value, field);
    typed.current[field] = shown.current[field] = text;
    setDates((current) => ({ ...current, [field]: text }));
    if (sameTime(read.value, saved.current[field])) return;
    saved.current[field] = read.value;
    void dateFields[field].write(project.id, read.value);
  }

  function close(abandon?: DateFieldName) {
    if (closed.current) return;
    closed.current = true;
    for (const field of fieldOrder) if (field !== abandon) save(field);
    onClose();
  }

  function onKeyDown(field: DateFieldName, event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') return close(field);
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    if (meaning(field).kind === 'invalid') return;
    if (event.key === 'Enter') return close();
    save(field);
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
          placeholder={field === 'defer' ? 'Defer' : 'Due'}
          text={dates[field]}
          initialText={shown.current[field]}
          inputRef={fields[field]}
          onChange={(text) => {
            typed.current[field] = text;
            setDates((current) => ({ ...current, [field]: text }));
          }}
          onKeyDown={(event) => onKeyDown(field, event)}
        />
      ))}
    </div>
  );
}
