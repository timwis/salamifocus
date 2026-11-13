import { nameProblem, normaliseName, positionAt, ProjectKind, type OrganisationNode } from '@salamifocus/domain';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { isTyping, useCurrentRow, useRovingFocus } from '../focus.ts';
import { createFolder, createProject, moveFolder, moveProject, renameFolder, renameProject } from '../writes.ts';

interface Row {
  node: OrganisationNode;
  depth: number;
  parentId: string | null;
  ancestors: string[];
  siblings: OrganisationNode[];
  index: number;
}

type NewKind = 'folder' | ProjectKind;

type Editing =
  | { mode: 'rename'; id: string }
  | { mode: 'create'; kind: NewKind; parentId: string | null; position: string; afterKey: string | null; depth: number; returnTo: string | null };

const EMPTY = 'empty';
const collapsedKey = 'salamifocus.sidebar.collapsed';

function flatten(nodes: OrganisationNode[], collapsed: Set<string>, parent: Row | null = null): Row[] {
  return nodes.flatMap((node, index) => {
    const row: Row = {
      node,
      depth: (parent?.depth ?? 0) + 1,
      parentId: parent?.node.id ?? null,
      ancestors: parent ? [...parent.ancestors, parent.node.id] : [],
      siblings: nodes,
      index,
    };
    return node.type === 'folder' && !collapsed.has(node.id) ? [row, ...flatten(node.children, collapsed, row)] : [row];
  });
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(collapsedKey) ?? '[]')));
  useEffect(() => localStorage.setItem(collapsedKey, JSON.stringify([...collapsed])), [collapsed]);
  const set = (id: string, isCollapsed: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (isCollapsed) next.add(id);
      else next.delete(id);
      return next;
    });
  return [collapsed, set] as const;
}

function move(node: OrganisationNode, parentId: string | null, position: string) {
  return node.type === 'folder' ? moveFolder(node.id, parentId, position) : moveProject(node.id, parentId, position);
}

export function Sidebar({
  tree,
  selection,
  onSelect,
}: {
  tree: OrganisationNode[];
  selection: string[];
  onSelect: (ids: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useCollapsed();
  const rows = flatten(tree, collapsed);
  const current = useCurrentRow(
    rows.map((r) => r.node.id),
    selection[0] ?? null,
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const focusIndex = current.index;
  const focused = rows[focusIndex] ?? null;
  const setFocusedId = current.set;
  const focusKey = editing?.mode === 'create' ? 'draft' : (current.key ?? EMPTY);
  const roving = useRovingFocus<HTMLUListElement>(focusKey);

  const selected = new Set(selection);

  function focusRow(index: number, how: 'select' | 'extend' | 'focus') {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!row) return;
    roving.claim();
    setFocusedId(row.node.id);
    if (how === 'select') onSelect([row.node.id]);
    if (how === 'extend' && !selected.has(row.node.id)) onSelect([...selection, row.node.id]);
  }

  function startCreating(kind: NewKind) {
    roving.claim();
    const returnTo = focused?.node.id ?? null;
    if (focused?.node.type === 'folder') {
      // A new item goes inside a focused folder, at the end.
      const folder = focused.node;
      setCollapsed(folder.id, false);
      const descendants = flatten(folder.children, new Set([...collapsed].filter((id) => id !== folder.id)), focused);
      const afterKey = descendants.at(-1)?.node.id ?? folder.id;
      const position = positionAt(folder.children, folder.children.length);
      setEditing({ mode: 'create', kind, parentId: folder.id, position, afterKey, depth: focused.depth + 1, returnTo });
    } else if (focused) {
      const position = positionAt(focused.siblings, focused.index + 1);
      setEditing({ mode: 'create', kind, parentId: focused.parentId, position, afterKey: focused.node.id, depth: focused.depth, returnTo });
    } else {
      setEditing({ mode: 'create', kind, parentId: null, position: positionAt(tree, tree.length), afterKey: null, depth: 1, returnTo });
    }
  }

  async function finishEditing(name: string | null) {
    const finished = editing;
    setEditing(null);
    if (!finished || name === null) {
      if (finished?.mode === 'create') setFocusedId(finished.returnTo);
      return;
    }
    if (finished.mode === 'rename') {
      const node = rows.find((r) => r.node.id === finished.id)?.node;
      if (!node || node.name === name) return;
      await (node.type === 'folder' ? renameFolder(node.id, name) : renameProject(node.id, name));
      return;
    }
    const id = crypto.randomUUID();
    current.await(id);
    onSelect([id]);
    if (finished.kind === 'folder') await createFolder(id, name, finished.parentId, finished.position);
    else await createProject(id, name, finished.kind, finished.parentId, finished.position);
  }

  function reorder(row: Row, by: -1 | 1) {
    const target = row.index + by;
    if (target < 0 || target >= row.siblings.length) return;
    const others = row.siblings.filter((s) => s.id !== row.node.id);
    void move(row.node, row.parentId, positionAt(others, target));
  }

  function moveIntoFolderAbove(row: Row) {
    const above = row.siblings[row.index - 1];
    if (above?.type !== 'folder') return;
    setCollapsed(above.id, false);
    void move(row.node, above.id, positionAt(above.children, above.children.length));
  }

  function moveOutOfFolder(row: Row) {
    const parent = rows.find((r) => r.node.id === row.parentId);
    if (!parent) return;
    const others = parent.siblings.filter((s) => s.id !== row.node.id);
    void move(row.node, parent.parentId, positionAt(others, parent.index + 1));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isTyping(event)) return;
    const { key, altKey, shiftKey, ctrlKey, metaKey } = event;
    const handled = () => event.preventDefault();

    if (key === 'n' && !ctrlKey && !metaKey && !altKey) return handled(), startCreating(ProjectKind.project);
    if (key === 'f' && !ctrlKey && !metaKey && !altKey) return handled(), startCreating('folder');
    if (key === 's' && !ctrlKey && !metaKey && !altKey) return handled(), startCreating(ProjectKind.singleActions);
    if (!focused) return;

    if (altKey) {
      if (key === 'ArrowUp') return handled(), reorder(focused, -1);
      if (key === 'ArrowDown') return handled(), reorder(focused, 1);
      if (key === 'ArrowRight') return handled(), moveIntoFolderAbove(focused);
      if (key === 'ArrowLeft') return handled(), moveOutOfFolder(focused);
      return;
    }
    const how = shiftKey ? 'extend' : ctrlKey || metaKey ? 'focus' : 'select';
    switch (key) {
      case 'ArrowDown':
        return handled(), focusRow(focusIndex + 1, how);
      case 'ArrowUp':
        return handled(), focusRow(focusIndex - 1, how);
      case 'Home':
        return handled(), focusRow(0, how);
      case 'End':
        return handled(), focusRow(rows.length - 1, how);
      case 'ArrowRight':
        handled();
        if (focused.node.type !== 'folder') return;
        if (collapsed.has(focused.node.id)) return setCollapsed(focused.node.id, false);
        if (focused.node.children.length > 0) return focusRow(focusIndex + 1, how);
        return;
      case 'ArrowLeft': {
        handled();
        if (focused.node.type === 'folder' && !collapsed.has(focused.node.id)) return setCollapsed(focused.node.id, true);
        const parentIndex = rows.findIndex((r) => r.node.id === focused.parentId);
        if (parentIndex !== -1) focusRow(parentIndex, how);
        return;
      }
      case ' ':
        handled();
        return onSelect(selected.has(focused.node.id) ? selection.filter((id) => id !== focused.node.id) : [...selection, focused.node.id]);
      case 'Enter':
      case 'F2':
        return handled(), setEditing({ mode: 'rename', id: focused.node.id });
    }
  }

  function onRowClick(event: MouseEvent, index: number) {
    const row = rows[index]!;
    if (event.metaKey || event.ctrlKey) {
      setFocusedId(row.node.id);
      onSelect(selected.has(row.node.id) ? selection.filter((id) => id !== row.node.id) : [...selection, row.node.id]);
    } else if (event.shiftKey && focused) {
      const [from, to] = [focusIndex, index].sort((a, b) => a - b) as [number, number];
      setFocusedId(row.node.id);
      onSelect(rows.slice(from, to + 1).map((r) => r.node.id));
    } else {
      focusRow(index, 'select');
    }
  }

  const draft =
    editing?.mode === 'create' ? (
      <li key="draft" role="treeitem" aria-level={editing.depth} aria-selected={false} data-key="draft" className="tree-row" style={indent(editing.depth)}>
        <span className={`icon icon-${editing.kind}`} aria-hidden />
        <NameEditor
          label={editing.kind === 'folder' ? 'New folder name' : editing.kind === ProjectKind.singleActions ? 'New single-action list name' : 'New project name'}
          initial=""
          onDone={finishEditing}
        />
      </li>
    ) : null;

  return (
    <aside className="sidebar" data-region="sidebar" aria-label="Sidebar">
      <ul
        ref={roving.ref}
        role="tree"
        aria-label="Folders and projects"
        aria-multiselectable
        className="tree"
        data-key={EMPTY}
        tabIndex={rows.length === 0 && !editing ? 0 : -1}
        onKeyDown={onKeyDown}
        {...roving.handlers}
      >
        {draft && editing?.mode === 'create' && editing.afterKey === null && draft}
        {rows.map((row, index) => {
          const { node, depth } = row;
          const renaming = editing?.mode === 'rename' && editing.id === node.id;
          const isFolder = node.type === 'folder';
          const isCollapsed = isFolder && collapsed.has(node.id);
          return [
            <li
              key={node.id}
              role="treeitem"
              data-key={node.id}
              data-kind={isFolder ? 'folder' : node.kind}
              aria-level={depth}
              aria-selected={selected.has(node.id)}
              aria-expanded={isFolder ? !isCollapsed : undefined}
              tabIndex={node.id === focused?.node.id && !editing ? 0 : -1}
              className="tree-row"
              style={indent(depth)}
              onClick={(event) => onRowClick(event, index)}
              onDoubleClick={() => setEditing({ mode: 'rename', id: node.id })}
              onFocus={(event) => event.target === event.currentTarget && setFocusedId(node.id)}
            >
              <span
                className={isFolder ? `disclosure ${isCollapsed ? 'closed' : 'open'}` : 'disclosure'}
                aria-hidden
                onClick={(event) => {
                  if (!isFolder) return;
                  event.stopPropagation();
                  setCollapsed(node.id, !isCollapsed);
                }}
              />
              <span className={`icon icon-${isFolder ? 'folder' : node.kind}`} aria-hidden />
              {renaming ? <NameEditor label="Name" initial={node.name} onDone={finishEditing} /> : <span className="name">{node.name}</span>}
            </li>,
            editing?.mode === 'create' && editing.afterKey === node.id ? draft : null,
          ];
        })}
      </ul>
      {rows.length === 0 && !editing && <p className="hint">Press N for a new project, F for a folder, S for a single-action list.</p>}
    </aside>
  );
}

const indent = (depth: number) => ({ paddingLeft: `${(depth - 1) * 1.1 + 0.4}rem` });

function NameEditor({ label, initial, onDone }: { label: string; initial: string; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const finished = useRef(false);

  function finish(result: string | null) {
    if (finished.current) return;
    finished.current = true;
    onDone(result);
  }

  function submit() {
    const reason = nameProblem(name);
    if (reason) return setProblem(reason);
    finish(normaliseName(name));
  }

  return (
    <span className="editor">
      <input
        aria-label={label}
        value={name}
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') submit();
          if (event.key === 'Escape') finish(null);
        }}
        onClick={(event) => event.stopPropagation()}
        onBlur={() => (nameProblem(name) ? finish(null) : finish(normaliseName(name)))}
      />
      {problem && <span role="alert">{problem}</span>}
    </span>
  );
}
