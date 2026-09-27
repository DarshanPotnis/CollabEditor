/**
 * Deleted files and folders, with Restore and Delete forever for each, and
 * Empty all. This is also the only way back to a deleted file whose tab was
 * closed, and the way under the total node limit.
 */
import { useMemo, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { listDeletedItems, type DeletedItem, type ResolvedTree } from '@collabcode/shared';
import { relativeTime } from '../../lib/relative-time.js';
import { useNow } from '../../lib/useNow.js';
import type { TreeActions } from '../file-tree/useTreeActions.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { deletedByLabel, folderLabel, purgeConfirmation } from './deleted-copy.js';

export type RecentlyDeletedProps = {
  tree: ResolvedTree;
  actions: TreeActions;
  myUserId: string;
};

type Confirming = { items: DeletedItem[]; target: readonly string[] | 'all' };

function Row({
  item,
  now,
  myUserId,
  onRestore,
  onPurge,
}: {
  item: DeletedItem;
  now: number;
  myUserId: string;
  onRestore: () => void;
  onPurge: () => void;
}): React.ReactElement {
  const Icon = item.kind === 'folder' ? Folder : File;
  return (
    <li className="border-b border-zinc-900 px-3 py-2">
      <div className="flex items-center gap-1.5 text-sm text-zinc-200">
        <Icon className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
        <span className="truncate font-medium">{item.name}</span>
      </div>
      <p className="mt-0.5 text-xs text-zinc-500">
        In {folderLabel(item)} · deleted by {deletedByLabel(item, myUserId)} ·{' '}
        <time dateTime={new Date(item.deletedAt).toISOString()}>
          {relativeTime(item.deletedAt, now)}
        </time>
        {item.containedCount > 0 &&
          ` · ${String(item.containedCount)} ${item.containedCount === 1 ? 'item' : 'items'} inside`}
      </p>
      <div className="mt-1.5 flex gap-3 text-xs">
        <button type="button" onClick={onRestore} className="text-sky-300 hover:text-sky-200">
          Restore<span className="sr-only"> {item.name}</span>
        </button>
        <button type="button" onClick={onPurge} className="text-red-300 hover:text-red-200">
          Delete forever<span className="sr-only"> {item.name}</span>
        </button>
      </div>
    </li>
  );
}

export function RecentlyDeleted({
  tree,
  actions,
  myUserId,
}: RecentlyDeletedProps): React.ReactElement {
  const items = useMemo(() => listDeletedItems(tree), [tree]);
  const now = useNow();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const copy = confirming ? purgeConfirmation(confirming.items) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {items.length === 0 ? (
        <p className="px-3 py-3 text-sm text-zinc-500">
          Nothing here. Deleted files and folders show up here so anyone can restore them.
        </p>
      ) : (
        <ul aria-label="Recently deleted" className="min-h-0 flex-1 overflow-y-auto">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              now={now}
              myUserId={myUserId}
              onRestore={() => actions.restore(item.id)}
              onPurge={() => setConfirming({ items: [item], target: [item.id] })}
            />
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <div className="border-t border-zinc-800 p-2">
          <button
            type="button"
            onClick={() => setConfirming({ items, target: 'all' })}
            className="w-full rounded-md border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950/50"
          >
            Empty all
          </button>
        </div>
      )}
      {confirming && copy && (
        <ConfirmDialog
          title={copy.title}
          message={copy.message}
          confirmLabel="Delete forever"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            actions.purge(confirming.target);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
