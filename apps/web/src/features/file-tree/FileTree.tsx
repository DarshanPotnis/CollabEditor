/**
 * The project's files, drawn from the resolved tree. It never reads or writes
 * the Y.Doc itself: it renders rows and reports what the user asked for.
 *
 * Keyboard support follows the WAI-ARIA treeview pattern (tree-keyboard.ts)
 * with a roving tabindex: one row is in the tab order, arrow keys move it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import type { ResolvedTree } from '@collabcode/shared';
import type { FilePresence } from '../../collab/file-presence.js';
import { PresenceDots } from './PresenceDots.js';
import { treeKeyAction } from './tree-keyboard.js';
import type { ExpandedFolders } from './useExpandedFolders.js';
import { ancestorIds, visibleRows, type TreeRow } from './visible-rows.js';

export type FileTreeProps = {
  tree: ResolvedTree;
  folders: ExpandedFolders;
  activeFileId: string | null;
  presence: FilePresence;
  onOpenFile: (id: string) => void;
};

function RowIcon({ row }: { row: TreeRow }): React.ReactElement {
  if (row.kind === 'file') return <File className="size-3.5 shrink-0 text-zinc-500" aria-hidden />;
  const Icon = row.expanded ? FolderOpen : Folder;
  return <Icon className="size-3.5 shrink-0 text-sky-400/80" aria-hidden />;
}

export function FileTree({
  tree,
  folders,
  activeFileId,
  presence,
  onOpenFile,
}: FileTreeProps): React.ReactElement {
  const rows = useMemo(() => visibleRows(tree, folders.expanded), [tree, folders.expanded]);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Reveal the active file: open every folder above it.
  const { expandAll } = folders;
  useEffect(() => {
    if (activeFileId !== null) expandAll(ancestorIds(tree, activeFileId));
  }, [activeFileId, tree, expandAll]);

  // The row that holds the tab stop: the focused one if it is still on
  // screen, else the active file, else the first row.
  const tabStopId =
    rows.find((row) => row.id === focusedId)?.id ??
    rows.find((row) => row.id === activeFileId)?.id ??
    rows[0]?.id ??
    null;

  const focusRow = (id: string): void => {
    setFocusedId(id);
    rowElements.current.get(id)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const action = treeKeyAction(event, rows, tabStopId);
    switch (action.type) {
      case 'none':
      case 'rename':
      case 'delete':
        return;
      case 'focus':
        focusRow(action.id);
        break;
      case 'expand':
        folders.setExpanded(action.id, true);
        break;
      case 'collapse':
        folders.setExpanded(action.id, false);
        break;
      case 'open':
        onOpenFile(action.id);
        break;
    }
    event.preventDefault();
  };

  const activate = (row: TreeRow): void => {
    setFocusedId(row.id);
    if (row.kind === 'folder') folders.toggle(row.id);
    else onOpenFile(row.id);
  };

  return (
    <section aria-labelledby="files-heading" className="flex h-full flex-col">
      <h2
        id="files-heading"
        className="border-b border-zinc-800 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase"
      >
        Files
      </h2>
      <div
        role="tree"
        aria-labelledby="files-heading"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {rows.map((row) => {
          const active = row.id === activeFileId;
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
              onFocus={() => setFocusedId(row.id)}
              style={{ paddingLeft: `${String(0.5 + (row.level - 1) * 0.75)}rem` }}
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
              <RowIcon row={row} />
              <span className="truncate">{row.displayName}</span>
              <PresenceDots people={presence.get(row.id)} />
            </div>
          );
        })}
        {rows.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">No files yet.</p>}
      </div>
    </section>
  );
}
