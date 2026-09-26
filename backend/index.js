"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const registerSocketHandlers = require("./socketHandlers");

const app = express();

// Health check (Render pings this to keep the service marked healthy).
app.get("/", (req, res) => {
  res.send("Collab Editor Backend is running");
});

const server = http.createServer(app);

// Defaults to "*" so local dev and the current Vercel deploy keep working;
// set ALLOWED_ORIGINS to a comma-separated list to lock it down.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

registerSocketHandlers(io);

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
