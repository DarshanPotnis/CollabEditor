/**
 * Per-client CSS for y-monaco's remote selections.
 *
 * y-monaco 0.1.6 decorates remote selections with `yRemoteSelection-<clientID>`
 * and the caret with `yRemoteSelectionHead-<clientID>` (verified against the
 * installed source), and leaves the colors to us.
 *
 * Everything interpolated here comes from another browser. Colors are already
 * restricted to a fixed palette by the awareness schema, and names are escaped
 * before they enter a CSS string. Nothing else from a peer reaches a stylesheet.
 */
import { escapeCssString, type AwarenessUser } from '@collabcode/shared';

export type RemoteCursor = {
  clientId: number;
  user: AwarenessUser;
};

/** Hex alpha suffix for the selection highlight (20%). */
const SELECTION_ALPHA = '33';

/**
 * Only integer client ids become class-name suffixes. A non-integer could
 * never come from Yjs, but this is the last step before the string is CSS.
 */
function isUsableClientId(clientId: number): boolean {
  return Number.isSafeInteger(clientId) && clientId >= 0;
}

export function remoteCursorStyles(cursors: readonly RemoteCursor[]): string {
  return cursors
    .filter((cursor) => isUsableClientId(cursor.clientId))
    .map(({ clientId, user }) => {
      const color = user.color;
      const label = escapeCssString(user.name);
      // An AI agent's caret is dashed, so its typing is never mistaken for a person's.
      const caret = user.kind === 'agent' ? 'dashed' : 'solid';
      return `.yRemoteSelection-${String(clientId)} {
  background-color: ${color}${SELECTION_ALPHA};
}
.yRemoteSelectionHead-${String(clientId)} {
  position: relative;
  border-left: 2px ${caret} ${color};
  border-top: 2px solid ${color};
  height: 100%;
  box-sizing: border-box;
}
.yRemoteSelectionHead-${String(clientId)}::after {
  content: "${label}";
  position: absolute;
  top: -1.35em;
  left: -2px;
  padding: 0 4px;
  border-radius: 3px 3px 3px 0;
  background-color: ${color};
  color: #ffffff;
  font-size: 11px;
  line-height: 1.3;
  font-family: ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}`;
    })
    .join('\n');
}
