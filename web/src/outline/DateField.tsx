import { describeDate, readDateEntry, type DateKind } from '@salamifocus/domain';
import { useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';

/** What a date field's text means now: nothing changed, a date, no date, or text that is not a date. */
export type DateFieldMeaning = { kind: 'unchanged' } | { kind: 'date'; value: string | null } | { kind: 'invalid' };

/** The text a date field starts with for a stored date: the date in full, so it reads back as itself. */
export const dateText = (value: string | null, kind: DateKind) => (value ? describeDate(value, kind, new Date(), { year: true }) : '');

/** Whether two stored dates are the same moment, however each is written. */
const sameTime = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

/** Reads a date field's text, typed relative to now, against the text it started with. */
export function dateFieldMeaning(text: string, initialText: string, kind: DateKind): DateFieldMeaning {
  if (text === initialText) return { kind: 'unchanged' };
  const entry = readDateEntry(text, kind, new Date());
  if (entry.kind === 'invalid') return entry;
  return { kind: 'date', value: entry.kind === 'date' ? entry.date.toISOString() : null };
}

/** An editor's defer and due fields: what each shows, and saving each when it is left. */
export interface DateFields {
  text: Record<DateKind, string>;
  /** The text a field showed for its saved date, which is not read again if left as it is. */
  shownText: (field: DateKind) => string;
  change: (field: DateKind, text: string) => void;
  /** Whether a field's text is not a date, so leaving it waits until it is one, is emptied or is abandoned. */
  invalid: (field: DateKind) => boolean;
  /** Writes a field's date if it has changed, and shows it in full. Text that is not a date is left as it is. */
  save: (field: DateKind) => void;
}

/** Holds an editor's date fields, starting from the saved dates and writing each changed one with `write`. */
export function useDateFields(saved: Record<DateKind, string | null>, write: (field: DateKind, value: string | null) => void): DateFields {
  const [text, setText] = useState<Record<DateKind, string>>(() => ({ defer: dateText(saved.defer, 'defer'), due: dateText(saved.due, 'due') }));
  // Read without waiting for a re-render, as an editor saves while closing.
  const typed = useRef({ ...text });
  const shown = useRef({ ...text });
  const written = useRef({ ...saved });
  const meaning = (field: DateKind) => dateFieldMeaning(typed.current[field], shown.current[field], field);

  return {
    text,
    shownText: (field) => shown.current[field],
    change(field, next) {
      typed.current[field] = next;
      setText((current) => ({ ...current, [field]: next }));
    },
    invalid: (field) => meaning(field).kind === 'invalid',
    save(field) {
      const read = meaning(field);
      if (read.kind !== 'date') return;
      // Show what was saved in full, which also reads back as itself.
      const full = dateText(read.value, field);
      typed.current[field] = shown.current[field] = full;
      setText((current) => ({ ...current, [field]: full }));
      if (sameTime(read.value, written.current[field])) return;
      written.current[field] = read.value;
      write(field, read.value);
    },
  };
}

/**
 * A defer or due date typed in words, such as "1 week", "fri" or "1 Dec", showing the date it resolves to
 * (or that it is not a date) while it is being typed. Empty text clears the date. Keys go to the editor
 * through `onKeyDown`.
 */
export function DateField({
  label,
  placeholder,
  kind,
  text,
  initialText,
  onChange,
  onKeyDown,
  inputRef,
}: {
  label: string;
  placeholder: string;
  kind: DateKind;
  text: string;
  initialText: string;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef: Ref<HTMLInputElement>;
}) {
  const resolvedId = useId();
  const meaning = dateFieldMeaning(text, initialText, kind);
  const resolved =
    meaning.kind === 'invalid'
      ? 'Not a date'
      : meaning.kind === 'date'
        ? meaning.value === null
          ? 'No date'
          : describeDate(meaning.value, kind, new Date(), { year: true })
        : null;

  return (
    <span className="date-field">
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={meaning.kind === 'invalid' || undefined}
        aria-describedby={resolved ? resolvedId : undefined}
        placeholder={placeholder}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {resolved && (
        <span id={resolvedId} className={meaning.kind === 'invalid' ? 'resolved invalid' : 'resolved'} aria-live="polite">
          {resolved}
        </span>
      )}
    </span>
  );
}
