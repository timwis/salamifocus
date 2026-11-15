import { describeDate, readDateEntry, type DateKind } from '@salamifocus/domain';
import { useId, type KeyboardEvent, type Ref } from 'react';

/** What a date field's text means now: nothing changed, a date, no date, or text that is not a date. */
export type DateFieldMeaning = { kind: 'unchanged' } | { kind: 'date'; value: string | null } | { kind: 'invalid' };

/** The text a date field starts with for a stored date: the date in full, so it reads back as itself. */
export const dateText = (value: string | null, kind: DateKind) => (value ? describeDate(value, kind, new Date(), { year: true }) : '');

/** Whether two stored dates are the same moment, however each is written. */
export const sameTime = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

/** Reads a date field's text, typed relative to now, against the text it started with. */
export function dateFieldMeaning(text: string, initialText: string, kind: DateKind): DateFieldMeaning {
  if (text === initialText) return { kind: 'unchanged' };
  const entry = readDateEntry(text, kind, new Date());
  if (entry.kind === 'invalid') return entry;
  return { kind: 'date', value: entry.kind === 'date' ? entry.date.toISOString() : null };
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
