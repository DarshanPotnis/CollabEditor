import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";

import EditorToolbar from "../components/EditorToolbar";
import { useCollabSession } from "../hooks/useCollabSession";
import { useRemoteCursors } from "../hooks/useRemoteCursors";
import { createIdentity } from "../lib/identity";
import { parseRoomId } from "../lib/room";

function EditorPage() {
  const { roomId: rawRoomId } = useParams();
  const roomId = parseRoomId(rawRoomId);

  // Generated once per mount and stable thereafter, so it never re-triggers the
  // session effect and tears down the socket.
  const [identity] = useState(createIdentity);
  const [editor, setEditor] = useState(null);

  const {
    status,
    synced,
    selfId,
    code,
    language,
    users,
    cursors,
    typingUsername,
    applyLocalCode,
    changeLanguage,
    publishCursor,
  } = useCollabSession({
    roomId,
    username: identity.username,
    color: identity.color,
  });

  useRemoteCursors({ editor, cursors, users, selfId });

  const handleMount = useCallback((editorInstance) => {
    setEditor(editorInstance);
  }, []);

  useEffect(() => {
    if (!editor) return undefined;

    const subscription = editor.onDidChangeCursorPosition((event) => {
      publishCursor({
        lineNumber: event.position.lineNumber,
        column: event.position.column,
      });
    });

    return () => subscription.dispose();
  }, [editor, publishCursor]);

  if (!roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">That room link isn&apos;t valid</h1>
        <Link to="/" className="text-accent text-sm hover:underline">
          Back to start
        </Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-white">
      <EditorToolbar
        roomId={roomId}
        status={status}
        users={users}
        selfId={selfId}
        language={language}
        onLanguageChange={changeLanguage}
      />

      <div className="px-6 py-1 h-6 text-xs text-gray-400 italic">
        {typingUsername && `${typingUsername} is typing…`}
      </div>

      <div className="flex-1 relative">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={applyLocalCode}
          onMount={handleMount}
          theme="vs-dark"
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            // Editing before the server has sent the room's document would
            // broadcast an empty buffer and wipe everyone else's work.
            readOnly: !synced,
          }}
        />

        {!synced && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 text-sm text-gray-400">
            Syncing with room…
          </div>
        )}
      </div>
    </div>
  );
}

export default EditorPage;
