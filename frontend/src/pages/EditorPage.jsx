import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

/* =========================
   🔹 User identity helpers
   ========================= */
const randomNames = [
  "CoderFox",
  "DevTiger",
  "ByteWizard",
  "PixelNinja",
  "AlgoKnight",
  "StackHero",
  "CodeWolf",
];

const randomColor = () =>
  ["#22c55e", "#3b82f6", "#a855f7", "#f97316", "#ef4444"][
    Math.floor(Math.random() * 5)
  ];

const randomUsername = () =>
  randomNames[Math.floor(Math.random() * randomNames.length)] +
  Math.floor(Math.random() * 100);

/* ========================= */

/* 🔹 Backend URL (local + production safe) */
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5001";

const socket = io(BACKEND_URL);

function EditorPage() {
  const { roomId } = useParams();

  const [status, setStatus] = useState("connecting");
  const [userCount, setUserCount] = useState(1);
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState("// Welcome to CollabCode 🚀\n");
  const [isTyping, setIsTyping] = useState(false);

  // 🔹 Username + avatar color (fixed per session)
  const [username] = useState(randomUsername);
  const [color] = useState(randomColor);

  const editorRef = useRef(null);
  const decorationsRef = useRef([]);
  const remoteCursors = useRef({});
  const isRemoteUpdate = useRef(false);
  const typingTimeout = useRef(null);

  useEffect(() => {
    // 🔹 Join room with identity
    socket.emit("join-room", {
      roomId,
      username,
      color,
    });

    socket.on("connect", () => setStatus("connected"));
    socket.on("disconnect", () => setStatus("disconnected"));

    socket.on("user-count", setUserCount);
    socket.on("language-update", setLanguage);

    socket.on("user-typing", () => {
      setIsTyping(true);
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        setIsTyping(false);
      }, 1500);
    });

    socket.on("code-update", (newCode) => {
      isRemoteUpdate.current = true;
      setCode(newCode);
    });

    socket.on("cursor-update", ({ socketId, cursor }) => {
      remoteCursors.current[socketId] = cursor;
      updateDecorations();
    });

    return () => {
      socket.off();
    };
  }, [roomId, username, color]);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;

    editor.onDidChangeCursorPosition((e) => {
      socket.emit("cursor-change", {
        roomId,
        cursor: {
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        },
      });
    });

    updateDecorations();
  };

  const updateDecorations = () => {
    if (!editorRef.current) return;

    const decorations = Object.values(remoteCursors.current).map(
      (cursor) => ({
        range: {
          startLineNumber: cursor.lineNumber,
          startColumn: cursor.column,
          endLineNumber: cursor.lineNumber,
          endColumn: cursor.column + 1,
        },
        options: {
          className: "remote-cursor",
          beforeContentClassName: "remote-cursor-head",
          inlineClassName: "remote-cursor-inline",
        },
      })
    );

    decorationsRef.current =
      editorRef.current.deltaDecorations(
        decorationsRef.current,
        decorations
      );
  };

  const handleChange = (value) => {
    if (!isRemoteUpdate.current) {
      socket.emit("code-change", { roomId, code: value });
      socket.emit("typing", roomId);
    }
    isRemoteUpdate.current = false;
    setCode(value);
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-white">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-panel border-b border-gray-800">
        <div className="flex items-center gap-4">
          <span className="text-sm">
            Room: <span className="text-accent">{roomId}</span>
          </span>

          <span className="text-xs text-gray-400">👥 {userCount}</span>

          <span
            className={`text-xs px-2 py-1 rounded-full ${
              status === "connected"
                ? "bg-green-600/20 text-green-400"
                : "bg-red-600/20 text-red-400"
            }`}
          >
            {status}
          </span>

          {/* 🔹 Your avatar */}
          <div
            title={username}
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border border-gray-700"
            style={{ backgroundColor: color }}
          >
            {username[0]}
          </div>
        </div>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-gray-800 text-sm px-2 py-1 rounded-md"
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="cpp">C++</option>
        </select>
      </div>

      {isTyping && (
        <div className="px-6 py-1 text-xs text-gray-400 italic">
          Someone is typing…
        </div>
      )}

      {/* Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={handleChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  );
}

export default EditorPage;
