/** Wording for Recently deleted and its confirmations. */
import type { DeletedItem } from '@collabcode/shared';

export function deletedByLabel(item: DeletedItem, myUserId: string): string {
  if (item.deletedBy !== null && item.deletedBy === myUserId) return 'you';
  return item.deletedByName ?? 'someone';
}

export function folderLabel(item: DeletedItem): string {
  return item.folderPath === null ? 'project root' : item.folderPath;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Everything that goes, counting what is inside folders. */
export function purgeCount(items: readonly DeletedItem[]): number {
  return items.reduce((total, item) => total + 1 + item.containedCount, 0);
}

export function purgeConfirmation(items: readonly DeletedItem[]): {
  title: string;
  message: string;
} {
  const permanence = "This can't be undone, for anyone in this project.";
  const [only] = items;
  if (items.length === 1 && only) {
    const inside =
      only.containedCount > 0
        ? ` and the ${plural(only.containedCount, 'item', 'items')} inside it`
        : '';
    return {
      title: `Delete “${only.name}” forever?`,
      message: `“${only.name}”${inside} will be permanently deleted. ${permanence}`,
    };
  }
  return {
    title: 'Empty Recently deleted?',
    message: `${plural(purgeCount(items), 'file or folder', 'files and folders')} will be permanently deleted. ${permanence}`,
  };
}
