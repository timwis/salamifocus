import { normaliseNote, normaliseTitle, titleProblem } from '@salamifocus/domain';
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { Tags } from '../tags/data.ts';
import { editTaskNote, renameTask, tagTask, untagTask } from '../writes.ts';
import { TagsField } from './TagsField.tsx';

export interface EditableTask {
  id: string;
  title: string;
  note: string | null;
  tagIds: readonly string[];
}

export type Field = 'title' | 'tags' | 'note';

const fieldOrder: Field[] = ['title', 'tags', 'note'];

/**
 * Edits a task in place. Each field is saved when the user leaves it, so Tab
 * moves on with the change kept, and Escape abandons only the field being
 * edited. Leaving the editor (Enter in the title or the empty tags field,
 * Cmd/Ctrl+Enter in the note, or focus moving elsewhere) closes it.
 */
export function TaskEditor({ task, tags, startIn = 'title', onClose }: { task: EditableTask; tags: Tags; startIn?: Field; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? '');
  const [tagIds, setTagIds] = useState<string[]>([...task.tagIds]);
  const [problem, setProblem] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const fields = { title: useRef<HTMLInputElement>(null), tags: useRef<HTMLInputElement>(null), note: useRef<HTMLTextAreaElement>(null) };
  // What is typed, and what has been saved, without waiting for a re-render.
  const typed = useRef({ title: task.title, note: task.note ?? '', tags: [...task.tagIds] });
  const saved = useRef({ title: task.title, note: normaliseNote(task.note ?? ''), tags: [...task.tagIds] });
  const closed = useRef(false);

  useLayoutEffect(() => fields[startIn].current?.focus(), []);

  // If the editor goes away without closing (its task vanished in a sync, or another task's editor replaced it), keep what was typed.
  useEffect(
    () => () => {
      if (!closed.current) fieldOrder.forEach(save);
    },
    // save reads refs only, so the first render's copy stays correct.
    [],
  );

  function save(field: Field) {
    if (field === 'title') {
      if (titleProblem(typed.current.title)) return;
      const next = normaliseTitle(typed.current.title);
      if (next === saved.current.title) return;
      saved.current.title = next;
      void renameTask(task.id, next);
    } else if (field === 'note') {
      const next = normaliseNote(typed.current.note);
      if (next === saved.current.note) return;
      saved.current.note = next;
      void editTaskNote(task.id, next);
    } else {
      const before = new Set(saved.current.tags);
      const after = new Set(typed.current.tags);
      saved.current.tags = [...typed.current.tags];
      for (const id of after) if (!before.has(id)) void tagTask(task.id, id);
      for (const id of before) if (!after.has(id)) void untagTask(task.id, id);
    }
  }

  function close(abandon?: Field) {
    if (closed.current) return;
    closed.current = true;
    for (const field of fieldOrder) if (field !== abandon) save(field);
    onClose();
  }

  /** Common keys for every field: Tab and Shift+Tab move between fields (wrapping round), Escape abandons this one. */
  function onFieldKeyDown(field: Field, event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') return close(field);
    if (event.key === 'Tab') {
      event.preventDefault();
      save(field);
      const next = fieldOrder[(fieldOrder.indexOf(field) + (event.shiftKey ? -1 : 1) + fieldOrder.length) % fieldOrder.length]!;
      fields[next].current?.focus();
    }
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      // A blank title is refused on Tab as it is on Enter, rather than being quietly dropped later.
      const reason = titleProblem(typed.current.title);
      if (reason) {
        event.stopPropagation();
        event.preventDefault();
        return setProblem(reason);
      }
      if (event.key === 'Enter') return event.stopPropagation(), close();
    }
    onFieldKeyDown('title', event);
  }

  function onTagsKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') return close();
    onFieldKeyDown('tags', event);
  }

  function onNoteKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return close();
    onFieldKeyDown('note', event);
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
          onChange={(e) => {
            typed.current.title = e.target.value;
            setTitle(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onTitleKeyDown}
        />
        {problem && <span role="alert">{problem}</span>}
      </span>
      <TagsField
        tags={tags}
        value={tagIds}
        inputRef={fields.tags}
        onChange={(ids) => {
          typed.current.tags = ids;
          setTagIds(ids);
        }}
        onKeyDown={onTagsKeyDown}
      />
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
