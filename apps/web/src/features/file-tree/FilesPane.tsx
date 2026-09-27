/**
 * The left pane: a header with New file, New folder and Recently deleted,
 * above either the file tree or the Recently deleted list.
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, FilePlus, FolderPlus, Trash2 } from 'lucide-react';
import { listDeletedItems, type NodeKind, type ResolvedTree } from '@collabcode/shared';
import type { FilePresence } from '../../collab/file-presence.js';
import { RecentlyDeleted } from '../recently-deleted/RecentlyDeleted.js';
import { creationParent } from './creation-parent.js';
import { FileTree, type TreeEditing } from './FileTree.js';
import type { ExpandedFolders } from './useExpandedFolders.js';
import type { TreeActions } from './useTreeActions.js';

export type FilesView = 'files' | 'deleted';

export type FilesPaneProps = {
  tree: ResolvedTree;
  folders: ExpandedFolders;
  activeFileId: string | null;
  presence: FilePresence;
  actions: TreeActions;
  myUserId: string;
  view: FilesView;
  onViewChange: (view: FilesView) => void;
  onOpenFile: (id: string) => void;
  onError: (message: string) => void;
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-sky-500 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

export function FilesPane(props: FilesPaneProps): React.ReactElement {
  const { tree, folders, actions, view, onViewChange } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TreeEditing | null>(null);
  const deletedCount = useMemo(() => listDeletedItems(tree).length, [tree]);

  const startCreate = (kind: NodeKind): void => {
    const parentId = creationParent(tree, selectedId ?? props.activeFileId);
    if (parentId !== null) folders.setExpanded(parentId, true);
    setEditing({ mode: 'create', kind, parentId });
  };

  return (
    <section aria-labelledby="files-heading" className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-zinc-800 py-1 pr-1.5 pl-3">
        {view === 'deleted' && (
          <IconButton label="Back to files" onClick={() => onViewChange('files')}>
            <ArrowLeft className="size-4" aria-hidden />
          </IconButton>
        )}
        <h2
          id="files-heading"
          className="flex-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase"
        >
          {view === 'files' ? 'Files' : 'Recently deleted'}
        </h2>
        {view === 'files' && (
          <>
            <IconButton label="New file" onClick={() => startCreate('file')}>
              <FilePlus className="size-4" aria-hidden />
            </IconButton>
            <IconButton label="New folder" onClick={() => startCreate('folder')}>
              <FolderPlus className="size-4" aria-hidden />
            </IconButton>
            <IconButton
              label={`Recently deleted (${String(deletedCount)})`}
              onClick={() => onViewChange('deleted')}
            >
              <Trash2 className="size-4" aria-hidden />
              {deletedCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-zinc-600 px-0.5 text-center text-[9px] leading-3.5 text-white"
                >
                  {deletedCount > 99 ? '99+' : deletedCount}
                </span>
              )}
            </IconButton>
          </>
        )}
      </div>
      {view === 'files' ? (
        <FileTree
          tree={tree}
          folders={folders}
          activeFileId={props.activeFileId}
          presence={props.presence}
          actions={actions}
          selectedId={selectedId}
          editing={editing}
          onSelect={setSelectedId}
          onEdit={setEditing}
          onOpenFile={props.onOpenFile}
          onError={props.onError}
        />
      ) : (
        <RecentlyDeleted tree={tree} actions={actions} myUserId={props.myUserId} />
      )}
    </section>
  );
}
