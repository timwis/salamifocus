import { useQuery } from '@powersync/react';
import { inboxCondition } from '@salamifocus/domain';
import { Outline } from './outline/Outline.tsx';
import { unfinishedChildrenColumn } from './queries.ts';

interface InboxRow {
  id: string;
  title: string;
  note: string | null;
  position: string | null;
  project_id: string | null;
  project_name: string | null;
  unfinishedChildren: number;
}

/** Unfinished tasks still lacking a project or a tag, oldest first. */
export function Inbox() {
  const { data: rows } = useQuery<InboxRow>(
    `SELECT t.id, t.title, t.note, t.position, t.project_id, p.name AS project_name, ${unfinishedChildrenColumn}
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${inboxCondition}
     ORDER BY t.created_at, t.id`,
  );
  const tasks = rows.map((row) => ({ ...row, projectId: row.project_id, projectName: row.project_name }));

  return <Outline title="Inbox" groups={[{ id: 'inbox', heading: null, ordered: false, tasks }]} empty="Nothing in the Inbox." />;
}
