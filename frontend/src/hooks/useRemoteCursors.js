import { useEffect, useRef } from "react";

/**
 * Renders other people's carets in the Monaco editor, colored per user.
 *
 * Monaco styles decorations by CSS class name, so per-user colors need real
 * stylesheet rules. They are written into one <style> element that is rebuilt
 * whenever the roster changes.
 */

const CLASS_PREFIX = "rc-";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Socket ids are URL-safe base64, but a class name may not start with a digit,
// hence the prefix. The filter is belt-and-braces against a hostile id.
const classFor = (socketId) => CLASS_PREFIX + String(socketId).replace(/[^A-Za-z0-9_-]/g, "");

function buildStylesheet(users) {
  return users
    // The color arrives from another client via the server. It is validated
    // there too, but it lands in a stylesheet here, so it is checked again
    // rather than trusted.
    .filter((user) => HEX_COLOR_PATTERN.test(user?.color ?? ""))
    .map((user) => {
      const scope = classFor(user.socketId);
      return [
        `.${scope} { background-color: ${user.color}33; }`,
        `.${scope}-caret { border-left-color: ${user.color}; }`,
      ].join("\n");
    })
    .join("\n");
}

export function useRemoteCursors({ editor, cursors, users, selfId }) {
  const styleRef = useRef(null);
  const collectionRef = useRef(null);

  useEffect(() => {
    const element = document.createElement("style");
    element.setAttribute("data-collab-cursors", "");
    document.head.appendChild(element);
    styleRef.current = element;

    return () => {
      element.remove();
      styleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = buildStylesheet(users);
  }, [users]);

  useEffect(() => {
    if (!editor) return undefined;

    // Guard rather than assume: @monaco-editor/react resolves Monaco from a CDN
    // at runtime, so the exact version is not pinned by our lockfile.
    const collection = editor.createDecorationsCollection?.([]) ?? null;
    collectionRef.current = collection;

    return () => {
      collection?.clear();
      collectionRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    const collection = collectionRef.current;
    const model = editor?.getModel();
    if (!collection || !model) return;

    const usersById = new Map(users.map((user) => [user.socketId, user]));

    const decorations = Object.entries(cursors).flatMap(([socketId, cursor]) => {
      if (socketId === selfId) return [];

      const user = usersById.get(socketId);
      if (!user || !cursor) return [];

      // Cursor and code updates race, so a position can point past the end of
      // the document we currently hold. Clamping keeps Monaco from throwing.
      const start = model.validatePosition({
        lineNumber: cursor.lineNumber,
        column: cursor.column,
      });
      const end = model.validatePosition({
        lineNumber: cursor.lineNumber,
        column: cursor.column + 1,
      });

      const scope = classFor(socketId);

      return [
        {
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
          options: {
            className: `remote-cursor ${scope}`,
            beforeContentClassName: `remote-cursor-caret ${scope}-caret`,
            hoverMessage: { value: user.username },
          },
        },
      ];
    });

    collection.set(decorations);
  }, [editor, cursors, users, selfId]);
}
