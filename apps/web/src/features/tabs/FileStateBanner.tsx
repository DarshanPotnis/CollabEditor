/**
 * What the editor says about an open file that is gone: deleted (read-only,
 * with Restore) or permanently deleted (nothing left to show; close the tab).
 */
import type { HiddenNode } from '@collabcode/shared';

export function DeletedBanner({
  hidden,
  myUserId,
  onRestore,
}: {
  hidden: HiddenNode;
  myUserId: string;
  onRestore: () => void;
}): React.ReactElement {
  const who =
    hidden.deletedBy !== null && hidden.deletedBy === myUserId
      ? 'you'
      : (hidden.deletedByName ?? 'someone');
  const how = hidden.causeId === hidden.id ? 'Deleted' : 'Its folder was deleted';
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-900 bg-amber-950/60 px-4 py-1.5 text-sm text-amber-100"
    >
      <span>
        {how} by {who}. It is read-only until it is restored.
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
      >
        Restore
      </button>
    </div>
  );
}

export function PurgedNotice({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div role="status" className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm text-zinc-300">
          “{name}” was permanently deleted, so it can't be restored.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 rounded-md border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:border-zinc-500"
        >
          Close tab
        </button>
      </div>
    </div>
  );
}
