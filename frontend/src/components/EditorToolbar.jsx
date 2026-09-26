import { useState } from "react";
import { Check, Link2 } from "lucide-react";

import { LANGUAGES } from "../lib/constants";

const STATUS_STYLES = {
  connected: "bg-green-600/20 text-green-400",
  connecting: "bg-amber-600/20 text-amber-400",
  disconnected: "bg-red-600/20 text-red-400",
};

function PresenceBar({ users, selfId }) {
  if (users.length === 0) return null;

  return (
    <div className="flex items-center -space-x-2">
      {users.map((user) => (
        <div
          key={user.socketId}
          title={user.socketId === selfId ? `${user.username} (you)` : user.username}
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black ${
            user.socketId === selfId ? "ring-2 ring-accent" : "ring-1 ring-gray-700"
          }`}
          style={{ backgroundColor: user.color }}
        >
          {user.username.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  );
}

function EditorToolbar({ roomId, status, users, selfId, language, onLanguageChange }) {
  const [copied, setCopied] = useState(false);

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the room id is on screen to copy by hand.
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 bg-panel border-b border-gray-800">
      <div className="flex items-center gap-4">
        <span className="text-sm">
          Room: <span className="text-accent">{roomId}</span>
        </span>

        <button
          type="button"
          onClick={copyInviteLink}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copied" : "Copy link"}
        </button>

        <span className="text-xs text-gray-400">
          👥 {users.length || 1}
        </span>

        <span
          className={`text-xs px-2 py-1 rounded-full ${
            STATUS_STYLES[status] ?? STATUS_STYLES.disconnected
          }`}
        >
          {status}
        </span>

        <PresenceBar users={users} selfId={selfId} />
      </div>

      <select
        value={language}
        onChange={(event) => onLanguageChange(event.target.value)}
        aria-label="Editor language"
        className="bg-gray-800 text-sm px-2 py-1 rounded-md"
      >
        {LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default EditorToolbar;
