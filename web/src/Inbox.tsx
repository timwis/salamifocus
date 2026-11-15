import { useQuery } from '@powersync/react';
import { inboxCondition } from '@salamifocus/domain';
import { Outline } from './outline/Outline.tsx';

interface InboxRow {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_name: string | null;
}

/** Unfinished tasks still lacking a project or a tag, oldest first. */
export function Inbox() {
  const { data: rows } = useQuery<InboxRow>(
    `SELECT t.id, t.title, t.note, t.position, p.name AS project_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${inboxCondition}
     ORDER BY t.created_at, t.id`,
  );
  const tasks = rows.map((row) => ({ ...row, projectName: row.project_name }));

  return <Outline title="Inbox" groups={[{ id: 'inbox', heading: null, ordered: false, tasks }]} empty="Nothing in the Inbox." />;
}
