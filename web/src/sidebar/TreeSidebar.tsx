import { nameProblem, normaliseName, positionAt } from '@salamifocus/domain';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { isTyping, useCurrentRow, useRovingFocus } from '../focus.ts';

/** An item in a sidebar tree. Items with `children` can hold other items. */
export interface TreeNode {
  id: string;
  name: string;
  position: string;
  children?: readonly TreeNode[];
}

/** A kind of item the sidebar can create, with its key and button. */
export interface NewItemKind {
  kind: string;
  key: string;
  button: string;
  /** Lower-case name, as in "New folder". */
  name: string;
}

/** Something that can be done to the current item, with its key and button. */
export interface SidebarAction<N extends TreeNode> {
  key: string;
  /** The button's text for this item, or null when the action does not apply to it. */
  label: (node: N) => string | null;
  run: (node: N) => Promise<void>;
}

export interface TreeSidebarProps<N extends TreeNode> {
  label: string;
  tree: readonly N[];
  selection: string[];
  /** Whether more than one item can be selected at once. */
  multiple: boolean;
  onSelect: (ids: string[]) => void;
  /** Used for the icon and `data-kind`. */
  kindOf: (node: N) => string;
  /** Whether an item can be moved into this one with Alt+→. */
  canContain: (node: N) => boolean;
  /** Whether a new item goes inside this one (at the end) rather than after it. */
  createsInside: (node: N) => boolean;
  newKinds: readonly NewItemKind[];
  actions?: readonly SidebarAction<N>[];
  /** A word shown after an item's name, such as "Paused", or null. */
  badgeOf?: (node: N) => string | null;
  hint: string;
  collapsedStorageKey: string;
  create: (kind: string, id: string, name: string, parentId: string | null, position: string) => Promise<void>;
  rename: (node: N, name: string) => Promise<void>;
  move: (node: N, parentId: string | null, position: string) => Promise<void>;
}

interface Row<N extends TreeNode> {
  node: N;
  depth: number;
  parentId: string | null;
  siblings: readonly N[];
  index: number;
}

type Editing =
  | { mode: 'rename'; id: string }
  | { mode: 'create'; kind: NewItemKind; parentId: string | null; position: string; afterKey: string | null; depth: number; returnTo: string | null };

const EMPTY = 'empty';

const childrenOf = <N extends TreeNode>(node: N): readonly N[] => (node.children ?? []) as readonly N[];

function flatten<N extends TreeNode>(nodes: readonly N[], collapsed: Set<string>, parent: Row<N> | null = null): Row<N>[] {
  return nodes.flatMap((node, index) => {
    const row: Row<N> = { node, depth: (parent?.depth ?? 0) + 1, parentId: parent?.node.id ?? null, siblings: nodes, index };
    return node.children && !collapsed.has(node.id) ? [row, ...flatten(childrenOf(node), collapsed, row)] : [row];
  });
}

function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]')));
  useEffect(() => localStorage.setItem(storageKey, JSON.stringify([...collapsed])), [storageKey, collapsed]);
  const set = (id: string, isCollapsed: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (isCollapsed) next.add(id);
      else next.delete(id);
      return next;
    });
  return [collapsed, set] as const;
}

/**
 * A perspective's sidebar: a tree of named items that can be created,
 * renamed, reordered and moved from the keyboard, and selected to choose what
 * the outline shows.
 */
export function TreeSidebar<N extends TreeNode>(props: TreeSidebarProps<N>) {
  const { tree, selection, multiple, onSelect, kindOf, canContain, createsInside, newKinds, actions = [], badgeOf } = props;
  const [collapsed, setCollapsed] = useCollapsed(props.collapsedStorageKey);
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
  const expandable = (node: N) => node.children !== undefined && (node.children.length > 0 || createsInside(node));

  function toggle(id: string) {
    if (!multiple) return onSelect(selected.has(id) ? [] : [id]);
    onSelect(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]);
  }

  function focusRow(index: number, how: 'select' | 'extend' | 'focus') {
    const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (!row) return;
    roving.claim();
    setFocusedId(row.node.id);
    if (how === 'select' || (how === 'extend' && !multiple)) onSelect([row.node.id]);
    else if (how === 'extend' && !selected.has(row.node.id)) onSelect([...selection, row.node.id]);
  }

  function startCreating(kind: NewItemKind) {
    roving.claim();
    const returnTo = focused?.node.id ?? null;
    if (focused && createsInside(focused.node)) {
      const parent = focused.node;
      const children = childrenOf(parent);
      setCollapsed(parent.id, false);
      const descendants = flatten(children, new Set([...collapsed].filter((id) => id !== parent.id)), focused);
      const afterKey = descendants.at(-1)?.node.id ?? parent.id;
      const position = positionAt(children, children.length);
      setEditing({ mode: 'create', kind, parentId: parent.id, position, afterKey, depth: focused.depth + 1, returnTo });
    } else if (focused) {
      // Skip past the focused item's expanded descendants, so the draft appears where the new item will.
      const descendants = flatten(childrenOf(focused.node), collapsed, focused);
      const afterKey = focused.node.children && !collapsed.has(focused.node.id) ? (descendants.at(-1)?.node.id ?? focused.node.id) : focused.node.id;
      const position = positionAt(focused.siblings, focused.index + 1);
      setEditing({ mode: 'create', kind, parentId: focused.parentId, position, afterKey, depth: focused.depth, returnTo });
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
      await props.rename(node, name);
      return;
    }
    const id = crypto.randomUUID();
    current.await(id);
    onSelect([id]);
    await props.create(finished.kind.kind, id, name, finished.parentId, finished.position);
  }

  function reorder(row: Row<N>, by: -1 | 1) {
    const target = row.index + by;
    if (target < 0 || target >= row.siblings.length) return;
    const others = row.siblings.filter((s) => s.id !== row.node.id);
    void props.move(row.node, row.parentId, positionAt(others, target));
  }

  function moveIntoItemAbove(row: Row<N>) {
    const above = row.siblings[row.index - 1];
    if (!above || !canContain(above)) return;
    const children = childrenOf(above);
    setCollapsed(above.id, false);
    void props.move(row.node, above.id, positionAt(children, children.length));
  }

  function moveOutOfParent(row: Row<N>) {
    const parent = rows.find((r) => r.node.id === row.parentId);
    if (!parent) return;
    const others = parent.siblings.filter((s) => s.id !== row.node.id);
    void props.move(row.node, parent.parentId, positionAt(others, parent.index + 1));
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isTyping(event)) return;
    const { key, altKey, shiftKey, ctrlKey, metaKey } = event;
    const handled = () => event.preventDefault();

    const newKind = !ctrlKey && !metaKey && !altKey ? newKinds.find((k) => k.key.toLowerCase() === key) : undefined;
    if (newKind) return handled(), startCreating(newKind);
    if (!focused) return;
    const action = !ctrlKey && !metaKey && !altKey ? actions.find((a) => a.key.toLowerCase() === key && a.label(focused.node) !== null) : undefined;
    if (action) return handled(), void action.run(focused.node);

    if (altKey) {
      if (key === 'ArrowUp') return handled(), reorder(focused, -1);
      if (key === 'ArrowDown') return handled(), reorder(focused, 1);
      if (key === 'ArrowRight') return handled(), moveIntoItemAbove(focused);
      if (key === 'ArrowLeft') return handled(), moveOutOfParent(focused);
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
        if (!expandable(focused.node)) return;
        if (collapsed.has(focused.node.id)) return setCollapsed(focused.node.id, false);
        if (childrenOf(focused.node).length > 0) return focusRow(focusIndex + 1, how);
        return;
      case 'ArrowLeft': {
        handled();
        if (expandable(focused.node) && !collapsed.has(focused.node.id)) return setCollapsed(focused.node.id, true);
        const parentIndex = rows.findIndex((r) => r.node.id === focused.parentId);
        if (parentIndex !== -1) focusRow(parentIndex, how);
        return;
      }
      case ' ':
        return handled(), toggle(focused.node.id);
      case 'Enter':
      case 'F2':
        return handled(), setEditing({ mode: 'rename', id: focused.node.id });
    }
  }

  function onRowClick(event: MouseEvent, index: number) {
    const row = rows[index]!;
    if (event.metaKey || event.ctrlKey) {
      setFocusedId(row.node.id);
      toggle(row.node.id);
    } else if (event.shiftKey && focused && multiple) {
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
        <span className="disclosure" aria-hidden />
        <span className={`icon icon-${editing.kind.kind}`} aria-hidden />
        <NameEditor label={`New ${editing.kind.name} name`} initial="" onDone={finishEditing} />
      </li>
    ) : null;

  return (
    <aside className="sidebar" data-region="sidebar" aria-label="Sidebar">
      <ul
        ref={roving.ref}
        role="tree"
        aria-label={props.label}
        aria-multiselectable={multiple || undefined}
        className="tree"
        data-roving
        data-key={EMPTY}
        tabIndex={rows.length === 0 && !editing ? 0 : -1}
        onKeyDown={onKeyDown}
        {...roving.handlers}
      >
        {draft && editing?.mode === 'create' && editing.afterKey === null && draft}
        {rows.map((row, index) => {
          const { node, depth } = row;
          const renaming = editing?.mode === 'rename' && editing.id === node.id;
          const canExpand = expandable(node);
          const isCollapsed = canExpand && collapsed.has(node.id);
          const badge = badgeOf?.(node) ?? null;
          return [
            <li
              key={node.id}
              role="treeitem"
              data-key={node.id}
              data-kind={kindOf(node)}
              data-badge={badge ?? undefined}
              aria-level={depth}
              aria-selected={selected.has(node.id)}
              aria-expanded={canExpand ? !isCollapsed : undefined}
              tabIndex={node.id === focused?.node.id && !editing ? 0 : -1}
              data-current={node.id === focused?.node.id || undefined}
              className="tree-row"
              style={indent(depth)}
              onClick={(event) => onRowClick(event, index)}
              onDoubleClick={() => setEditing({ mode: 'rename', id: node.id })}
            >
              <span
                className={canExpand ? `disclosure ${isCollapsed ? 'closed' : 'open'}` : 'disclosure'}
                aria-hidden
                onClick={(event) => {
                  if (!canExpand) return;
                  event.stopPropagation();
                  setCollapsed(node.id, !isCollapsed);
                }}
              />
              <span className={`icon icon-${kindOf(node)}`} aria-hidden />
              {renaming ? <NameEditor label="Name" initial={node.name} onDone={finishEditing} /> : <span className="name">{node.name}</span>}
              {badge && !renaming && <span className="badge">{badge}</span>}
            </li>,
            editing?.mode === 'create' && editing.afterKey === node.id ? draft : null,
          ];
        })}
      </ul>
      {rows.length === 0 && !editing && <p className="hint">{props.hint}</p>}
      {/* Mouse equivalents of the new-item keys; kept out of the Tab order so Tab still moves between regions. */}
      <div className="sidebar-actions">
        {newKinds.map((kind) => (
          <button
            key={kind.kind}
            type="button"
            tabIndex={-1}
            aria-label={`New ${kind.name}`}
            title={`New ${kind.name} (${kind.key})`}
            aria-keyshortcuts={kind.key}
            onClick={() => startCreating(kind)}
          >
            + {kind.button}
          </button>
        ))}
        {actions.map((action) => {
          const label = focused && action.label(focused.node);
          if (!focused || !label) return null;
          return (
            <button
              key={action.key}
              type="button"
              tabIndex={-1}
              aria-label={`${label} ${focused.node.name}`}
              title={`${label} (${action.key})`}
              aria-keyshortcuts={action.key}
              onClick={() => void action.run(focused.node)}
            >
              {label}
            </button>
          );
        })}
      </div>
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
