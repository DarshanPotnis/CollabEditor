import { useState } from "react";

import { parseRoomId } from "../lib/room";

/** Takes a room id or a pasted invite link and hands the id to `onJoin`. */
function JoinRoomForm({ onJoin, onCancel }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);

  const handleSubmit = (event) => {
    event.preventDefault();

    const roomId = parseRoomId(value);
    if (!roomId) {
      setError("Enter a valid room ID or paste an invite link.");
      return;
    }

    setError(null);
    onJoin(roomId);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left">
      <label htmlFor="room-id" className="block text-xs text-gray-400">
        Room ID or invite link
      </label>

      <input
        id="room-id"
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        placeholder="e.g. a1b2c3d4"
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? "room-id-error" : undefined}
        className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:border-accent transition"
      />

      {error && (
        <p id="room-id-error" role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          className="flex-1 bg-accent text-black py-3 rounded-xl font-semibold hover:opacity-90 transition"
        >
          Join
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 border border-gray-700 rounded-xl text-sm hover:bg-gray-800 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default JoinRoomForm;
