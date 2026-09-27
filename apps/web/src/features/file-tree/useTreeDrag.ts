/**
 * Moving by drag and drop, with native HTML5 events (no library; touch is out
 * of scope). A drop is only offered where the move op would accept it, and
 * hovering a closed folder for a moment opens it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ResolvedTree } from '@collabcode/shared';
import { canMoveInto, dropParent } from './drop-target.js';
import type { TreeRow } from './visible-rows.js';

const DRAG_TYPE = 'application/x-collabcode-node';
const OPEN_FOLDER_AFTER_MS = 600;

type DragHandlers = Pick<
  React.HTMLAttributes<HTMLElement>,
  'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'
> & { draggable?: boolean };

export type TreeDrag = {
  /** The folder a drop would land in (null is the root), or undefined when no drop is on offer. */
  dropParentId: string | null | undefined;
  rowProps: (row: TreeRow, draggable: boolean) => DragHandlers;
  rootProps: DragHandlers;
};

export function useTreeDrag(
  tree: ResolvedTree,
  onMove: (id: string, parentId: string | null) => void,
  openFolder: (id: string) => void,
): TreeDrag {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropParentId, setDropParentId] = useState<string | null | undefined>(undefined);
  const openTimer = useRef<{ folderId: string; timer: number } | null>(null);

  const cancelOpen = (): void => {
    if (openTimer.current) window.clearTimeout(openTimer.current.timer);
    openTimer.current = null;
  };
  useEffect(() => cancelOpen, []);

  const reset = (): void => {
    cancelOpen();
    setDragId(null);
    setDropParentId(undefined);
  };

  const hover = (event: React.DragEvent, parentId: string | null): void => {
    if (dragId === null || !canMoveInto(tree, dragId, parentId)) {
      setDropParentId(undefined);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropParentId(parentId);
  };

  const drop = (event: React.DragEvent, parentId: string | null): void => {
    event.preventDefault();
    if (dragId !== null && canMoveInto(tree, dragId, parentId)) onMove(dragId, parentId);
    reset();
  };

  return {
    dropParentId,
    rowProps: (row, draggable) => ({
      draggable,
      onDragStart: (event) => {
        event.stopPropagation();
        // Firefox will not start a drag without data.
        event.dataTransfer.setData(DRAG_TYPE, row.id);
        event.dataTransfer.effectAllowed = 'move';
        setDragId(row.id);
      },
      onDragEnd: reset,
      onDragOver: (event) => {
        event.stopPropagation();
        hover(event, dropParent(tree, row.id));
        if (row.kind === 'folder' && !row.expanded && openTimer.current?.folderId !== row.id) {
          cancelOpen();
          openTimer.current = {
            folderId: row.id,
            timer: window.setTimeout(() => openFolder(row.id), OPEN_FOLDER_AFTER_MS),
          };
        }
      },
      onDrop: (event) => {
        event.stopPropagation();
        drop(event, dropParent(tree, row.id));
      },
    }),
    rootProps: {
      onDragOver: (event) => hover(event, null),
      onDrop: (event) => drop(event, null),
    },
  };
}
