import { normaliseNote, normaliseTitle, titleProblem } from '@salamifocus/domain';
import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { editTaskNote, renameTask } from '../writes.ts';

export interface EditableTask {
  id: string;
  title: string;
  note: string | null;
}

type Field = 'title' | 'note';

/**
 * Edits a task in place. Each field is saved when the user leaves it, so Tab
 * moves on with the change kept, and Escape abandons only the field being
 * edited. Leaving the editor (Enter in the title, Cmd/Ctrl+Enter in the
 * note, or focus moving elsewhere) closes it.
 */
export function TaskEditor({ task, onClose }: { task: EditableTask; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const fields = { title: useRef<HTMLInputElement>(null), note: useRef<HTMLTextAreaElement>(null) };
  // What is typed, and what has been saved, without waiting for a re-render.
  const typed = useRef({ title: task.title, note: task.note ?? '' });
  const saved = useRef({ title: task.title, note: normaliseNote(task.note ?? '') });
  const closed = useRef(false);

  function save(field: Field) {
    if (field === 'title') {
      if (titleProblem(typed.current.title)) return;
      const next = normaliseTitle(typed.current.title);
      if (next === saved.current.title) return;
      saved.current.title = next;
      void renameTask(task.id, next);
    } else {
      const next = normaliseNote(typed.current.note);
      if (next === saved.current.note) return;
      saved.current.note = next;
      void editTaskNote(task.id, next);
    }
  }

  function close(abandon?: Field) {
    if (closed.current) return;
    closed.current = true;
    if (abandon !== 'title') save('title');
    if (abandon !== 'note') save('note');
    onClose();
  }

  function moveTo(field: Field, from: Field, event: KeyboardEvent) {
    event.preventDefault();
    save(from);
    fields[field].current?.focus();
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      const reason = titleProblem(typed.current.title);
      return reason ? setProblem(reason) : close();
    }
    if (event.key === 'Escape') return close('title');
    if (event.key === 'Tab') return moveTo('note', 'title', event);
  }

  function onNoteKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return close();
    if (event.key === 'Escape') return close('note');
    if (event.key === 'Tab') return moveTo('title', 'note', event);
  }

  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && container.current?.contains(next)) return;
    close();
  }

  return (
    <div className="task-editor" ref={container} onBlur={onBlur} onClick={(event) => event.stopPropagation()}>
      <span className="editor">
        <input
          ref={fields.title}
          aria-label="Title"
          value={title}
          autoFocus
          onChange={(e) => {
            typed.current.title = e.target.value;
            setTitle(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onTitleKeyDown}
        />
        {problem && <span role="alert">{problem}</span>}
      </span>
      <textarea
        ref={fields.note}
        aria-label="Note"
        placeholder="Add note"
        className="note-field"
        rows={Math.max(1, note.split('\n').length)}
        value={note}
        onChange={(e) => {
          typed.current.note = e.target.value;
          setNote(e.target.value);
        }}
        onKeyDown={onNoteKeyDown}
      />
    </div>
  );
}
