const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// 🔹 Health check (important for Render)
app.get("/", (req, res) => {
  res.send("Collab Editor Backend is running");
});

const server = http.createServer(app);

// 🔹 Allow connections from anywhere (Vercel frontend)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 🔹 In-memory user store
const users = {}; // socketId -> { username, color, roomId }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, username, color }) => {
    socket.join(roomId);

    users[socket.id] = { username, color, roomId };

    const roomUsers = Object.values(users).filter(
      (u) => u.roomId === roomId
    );

    io.to(roomId).emit("room-users", roomUsers);
    io.to(roomId).emit("user-count", roomUsers.length);
  });

  socket.on("code-change", ({ roomId, code }) => {
    socket.to(roomId).emit("code-update", code);
  });

  socket.on("language-change", ({ roomId, language }) => {
    socket.to(roomId).emit("language-update", language);
  });

  socket.on("typing", (roomId) => {
    socket.to(roomId).emit("user-typing");
  });

  socket.on("cursor-change", ({ roomId, cursor }) => {
    socket.to(roomId).emit("cursor-update", {
      socketId: socket.id,
      cursor,
    });
  });

  socket.on("disconnecting", () => {
    const user = users[socket.id];
    if (!user) return;

    const { roomId } = user;
    delete users[socket.id];

    const roomUsers = Object.values(users).filter(
      (u) => u.roomId === roomId
    );

    io.to(roomId).emit("room-users", roomUsers);
    io.to(roomId).emit("user-count", roomUsers.length);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// 🔹 IMPORTANT: Use Render-provided port
const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
