import { useQuery } from '@powersync/react';
import { Outline } from './outline/Outline.tsx';

interface InboxRow {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
}

export function Inbox() {
  const { data: tasks } = useQuery<InboxRow>('SELECT id, title, note, position FROM tasks WHERE project_id IS NULL AND completed_at IS NULL ORDER BY created_at, id');

  return (
    <main data-region="outline" aria-labelledby="inbox-heading">
      <h2 id="inbox-heading">Inbox</h2>
      <Outline label="Inbox" groups={[{ id: 'inbox', heading: null, projectId: null, tasks }]} empty="Nothing in the Inbox." />
    </main>
  );
}
