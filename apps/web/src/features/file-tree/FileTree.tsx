/**
 * The project's files, drawn from the resolved tree. It never touches the
 * Y.Doc: it renders rows and calls the tree actions.
 *
 * Keyboard support follows the WAI-ARIA treeview pattern (tree-keyboard.ts)
 * with a roving tabindex: one row is in the tab order, arrow keys move it.
 * F2 renames, Delete deletes, Shift+F10 or the Menu key opens the menu.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import type { NodeKind, ResolvedTree } from '@collabcode/shared';
import type { FilePresence } from '../../collab/file-presence.js';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu.js';
import type { Point } from '../ui/menu-position.js';
import { InlineNameInput } from './InlineNameInput.js';
import { PresenceDots } from './PresenceDots.js';
import { treeKeyAction } from './tree-keyboard.js';
import type { ExpandedFolders } from './useExpandedFolders.js';
import type { TreeActions } from './useTreeActions.js';
import { ancestorIds, draftInsertIndex, visibleRows, type TreeRow } from './visible-rows.js';

export type TreeEditing =
  { mode: 'rename'; id: string } | { mode: 'create'; kind: NodeKind; parentId: string | null };

export type FileTreeProps = {
  tree: ResolvedTree;
  folders: ExpandedFolders;
  activeFileId: string | null;
  presence: FilePresence;
  actions: TreeActions;
  selectedId: string | null;
  editing: TreeEditing | null;
  onSelect: (id: string) => void;
  onEdit: (editing: TreeEditing | null) => void;
  onOpenFile: (id: string) => void;
  onError: (message: string) => void;
};

type MenuState = { anchor: Point; targetId: string | null };

const INDENT_REM = 0.75;

function indent(level: number): React.CSSProperties {
  return { paddingLeft: `${String(0.5 + (level - 1) * INDENT_REM)}rem` };
}

function KindIcon({ kind, open }: { kind: NodeKind; open: boolean }): React.ReactElement {
  if (kind === 'file') return <File className="size-3.5 shrink-0 text-zinc-500" aria-hidden />;
  const Icon = open ? FolderOpen : Folder;
  return <Icon className="size-3.5 shrink-0 text-sky-400/80" aria-hidden />;
}

export function FileTree({
  tree,
  folders,
  activeFileId,
  presence,
  actions,
  selectedId,
  editing,
  onSelect,
  onEdit,
  onOpenFile,
  onError,
}: FileTreeProps): React.ReactElement {
  const rows = useMemo(() => visibleRows(tree, folders.expanded), [tree, folders.expanded]);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Reveal the active file: open every folder above it.
  const { expandAll, setExpanded } = folders;
  useEffect(() => {
    if (activeFileId !== null) expandAll(ancestorIds(tree, activeFileId));
  }, [activeFileId, tree, expandAll]);

  // Focus a row once it exists, e.g. after an inline edit ends.
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const element = rowElements.current.get(id);
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  });

  // The row that holds the tab stop: the selected one if it is still on
  // screen, else the active file, else the first row.
  const tabStopId =
    rows.find((row) => row.id === selectedId)?.id ??
    rows.find((row) => row.id === activeFileId)?.id ??
    rows[0]?.id ??
    null;

  const focusRow = (id: string): void => {
    onSelect(id);
    rowElements.current.get(id)?.focus();
  };

  const endEdit = (focusId: string | null): void => {
    onEdit(null);
    if (focusId !== null) {
      onSelect(focusId);
      pendingFocus.current = focusId;
    }
  };

  const startCreate = (kind: NodeKind, parentId: string | null): void => {
    if (parentId !== null) setExpanded(parentId, true);
    onEdit({ mode: 'create', kind, parentId });
  };

  const remove = (id: string): void => {
    const node = tree.byId.get(id);
    if (node) actions.remove(id, node.displayName, node.kind);
  };

  const menuItems = (targetId: string | null): ContextMenuItem[] => {
    const node = targetId === null ? undefined : tree.byId.get(targetId);
    const create: ContextMenuItem[] = [
      { label: 'New file', onSelect: () => startCreate('file', node?.id ?? null) },
      { label: 'New folder', onSelect: () => startCreate('folder', node?.id ?? null) },
    ];
    if (!node) return create;
    const edit: ContextMenuItem[] = [
      { label: 'Rename', onSelect: () => onEdit({ mode: 'rename', id: node.id }) },
      { label: 'Delete', onSelect: () => remove(node.id), danger: true },
    ];
    return node.kind === 'folder' ? [...create, ...edit] : edit;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const action = treeKeyAction(event, rows, tabStopId);
    switch (action.type) {
      case 'none':
        return;
      case 'focus':
        focusRow(action.id);
        break;
      case 'expand':
        setExpanded(action.id, true);
        break;
      case 'collapse':
        setExpanded(action.id, false);
        break;
      case 'open':
        onOpenFile(action.id);
        break;
      case 'rename':
        onEdit({ mode: 'rename', id: action.id });
        break;
      case 'delete':
        remove(action.id);
        break;
      case 'menu': {
        const rect = rowElements.current.get(action.id)?.getBoundingClientRect();
        if (rect) setMenu({ anchor: { x: rect.left + 16, y: rect.bottom }, targetId: action.id });
        break;
      }
    }
    event.preventDefault();
  };

  const activate = (row: TreeRow): void => {
    onSelect(row.id);
    if (row.kind === 'folder') folders.toggle(row.id);
    else onOpenFile(row.id);
  };

  const renderRow = (row: TreeRow): React.ReactElement => {
    const active = row.id === activeFileId;
    const renaming = editing?.mode === 'rename' && editing.id === row.id;
    const node = tree.byId.get(row.id);

    return (
      <div
        key={row.id}
        ref={(element) => {
          if (element) rowElements.current.set(row.id, element);
          else rowElements.current.delete(row.id);
        }}
        role="treeitem"
        aria-level={row.level}
        aria-posinset={row.posInSet}
        aria-setsize={row.setSize}
        aria-expanded={row.kind === 'folder' ? row.expanded : undefined}
        aria-selected={active}
        tabIndex={row.id === tabStopId ? 0 : -1}
        title={row.path}
        onClick={() => activate(row)}
        onFocus={(event) => {
          if (event.target === event.currentTarget) onSelect(row.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect(row.id);
          setMenu({ anchor: { x: event.clientX, y: event.clientY }, targetId: row.id });
        }}
        style={indent(row.level)}
        className={`flex cursor-pointer items-center gap-1.5 py-1 pr-2 text-sm outline-none select-none focus-visible:ring-1 focus-visible:ring-sky-500 focus-visible:ring-inset ${
          active ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900'
        }`}
      >
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 text-zinc-500 transition-transform ${
            row.kind === 'folder' ? '' : 'invisible'
          } ${row.expanded ? 'rotate-90' : ''}`}
        />
        <KindIcon kind={row.kind} open={row.expanded} />
        {renaming && node ? (
          <InlineNameInput
            initial={node.name}
            label={`New name for ${node.displayName}`}
            onCommit={(name) => {
              const result = actions.rename(row.id, name);
              if (!result.ok) return result.error.message;
              endEdit(row.id);
              return null;
            }}
            onCancel={() => endEdit(row.id)}
            onAbandon={(message) => {
              endEdit(row.id);
              onError(message);
            }}
          />
        ) : (
          <span className="truncate">{row.displayName}</span>
        )}
        <PresenceDots people={presence.get(row.id)} />
      </div>
    );
  };

  const renderDraft = (draft: Extract<TreeEditing, { mode: 'create' }>): React.ReactElement => {
    const parentLevel =
      draft.parentId === null ? 0 : (tree.byId.get(draft.parentId)?.depth ?? -1) + 1;
    const noun = draft.kind === 'file' ? 'file' : 'folder';
    return (
      <div
        key="draft"
        role="none"
        style={indent(parentLevel + 1)}
        className="flex items-center gap-1.5 py-1 pr-2 text-sm"
      >
        <ChevronRight aria-hidden className="invisible size-3 shrink-0" />
        <KindIcon kind={draft.kind} open={false} />
        <InlineNameInput
          initial=""
          label={`Name for the new ${noun}`}
          onCommit={(name) => {
            const result = actions.create(draft.kind, draft.parentId, name);
            if (!result.ok) return result.error.message;
            endEdit(result.value);
            return null;
          }}
          onCancel={() => endEdit(null)}
          onAbandon={(message) => {
            endEdit(null);
            onError(message);
          }}
        />
      </div>
    );
  };

  const rendered = rows.map(renderRow);
  if (editing?.mode === 'create') {
    rendered.splice(draftInsertIndex(rows, editing.parentId), 0, renderDraft(editing));
  }

  return (
    <>
      <div
        role="tree"
        aria-labelledby="files-heading"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ anchor: { x: event.clientX, y: event.clientY }, targetId: null });
        }}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {rendered}
        {rows.length === 0 && !editing && (
          <p className="px-3 py-2 text-sm text-zinc-500">No files yet. Right-click to add one.</p>
        )}
      </div>
      {menu && (
        <ContextMenu
          anchor={menu.anchor}
          label={
            menu.targetId === null
              ? 'Project actions'
              : `Actions for ${tree.byId.get(menu.targetId)?.displayName ?? 'item'}`
          }
          items={menuItems(menu.targetId)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
