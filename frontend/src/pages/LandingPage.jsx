import { Code2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

function LandingPage() {
  const navigate = useNavigate();

  const createRoom = () => {
    const roomId = Math.random().toString(36).substring(2, 10);
    navigate(`/room/${roomId}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-panel w-full max-w-md rounded-2xl shadow-xl p-8 text-center">
        
        <div className="flex justify-center mb-4">
          <Code2 size={48} className="text-accent" />
        </div>

        <h1 className="text-3xl font-bold mb-2">CollabCode</h1>

        <p className="text-gray-400 mb-8">
          Real-time collaborative code editor for developers
        </p>

        <div className="space-y-4">
          <button
            onClick={createRoom}
            className="w-full bg-accent text-black py-3 rounded-xl font-semibold hover:opacity-90 transition"
          >
            Create New Room
          </button>

          <button className="w-full border border-gray-700 py-3 rounded-xl hover:bg-gray-800 transition">
            Join Existing Room
          </button>
        </div>

        <p className="text-xs text-gray-500 mt-8">
          Built with WebSockets • React • Node.js
        </p>
      </div>
    </div>
  );
}

export default LandingPage;
