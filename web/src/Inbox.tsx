import { useQuery } from '@powersync/react';
import { normaliseTitle, operationMetadata, OperationName, titleProblem } from '@salamifocus/domain';
import { useRef, useState, type KeyboardEvent } from 'react';
import { db } from './powersync.ts';

interface InboxRow {
  id: string;
  title: string;
}

export function Inbox() {
  const { data: tasks } = useQuery<InboxRow>('SELECT id, title FROM tasks ORDER BY created_at, id');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <main data-region="outline" aria-labelledby="inbox-heading">
      <h2 id="inbox-heading">Inbox</h2>
      {tasks.length === 0 ? (
        <p className="empty">Nothing in the Inbox.</p>
      ) : (
        <ul aria-labelledby="inbox-heading" className="tasks">
          {tasks.map((task) => (
            <li key={task.id}>
              {editing === task.id ? (
                <TitleEditor task={task} onDone={() => setEditing(null)} />
              ) : (
                <button type="button" className="task-title" onClick={() => setEditing(task.id)}>
                  {task.title}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function TitleEditor({ task, onDone }: { task: InboxRow; onDone: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [problem, setProblem] = useState<string | null>(null);
  const finished = useRef(false);

  function cancel() {
    finished.current = true;
    onDone();
  }

  async function save() {
    if (finished.current) return;
    const reason = titleProblem(title);
    if (reason) return setProblem(reason);
    finished.current = true;
    const next = normaliseTitle(title);
    if (next !== task.title) {
      await db.writeTransaction((tx) =>
        tx.execute('UPDATE tasks SET title = ?, _metadata = ? WHERE id = ?', [
          next,
          operationMetadata(OperationName.renameTask),
          task.id,
        ]),
      );
    }
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') void save();
    if (event.key === 'Escape') cancel();
  }

  return (
    <span className="editor">
      <input
        aria-label="Title"
        value={title}
        autoFocus
        onChange={(e) => {
          setTitle(e.target.value);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => (titleProblem(title) ? cancel() : void save())}
      />
      {problem && <span role="alert">{problem}</span>}
    </span>
  );
}
