const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 900 * 1024;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 120;

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1.2e6
});

const messages = new Map();
const cleanupTimers = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.emit("chat:init", Array.from(messages.values()));

  socket.on("chat:send", (payload, ack) => {
    const result = createMessage(socket.id, payload);

    if (!result.ok) {
      if (typeof ack === "function") ack({ ok: false, error: result.error });
      return;
    }

    messages.set(result.message.id, result.message);
    scheduleExpiry(result.message.id, result.message.expiresAt);
    io.emit("chat:message", result.message);

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    socket.broadcast.emit("chat:notice", "익명 사용자가 나갔습니다.");
  });

  socket.broadcast.emit("chat:notice", "익명 사용자가 들어왔습니다.");
});

function createMessage(socketId, payload = {}) {
  const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 600) : "";
  const image = typeof payload.image === "string" ? payload.image : "";
  const ttlSeconds = clamp(Number(payload.ttlSeconds) || 20, MIN_TTL_SECONDS, MAX_TTL_SECONDS);

  if (!text && !image) {
    return { ok: false, error: "메시지나 사진을 입력해 주세요." };
  }

  if (image && !isValidImageDataUrl(image)) {
    return { ok: false, error: "사진은 900KB 이하의 PNG, JPG, GIF, WebP만 가능합니다." };
  }

  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2)}`;

  return {
    ok: true,
    message: {
      id,
      senderId: socketId,
      name: normalizeName(payload.name),
      avatar: normalizeAvatar(payload.avatar),
      text,
      image,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000
    }
  };
}

function scheduleExpiry(id, expiresAt) {
  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(() => {
    messages.delete(id);
    cleanupTimers.delete(id);
    io.emit("chat:delete", id);
  }, delay);

  cleanupTimers.set(id, timer);
}

function isValidImageDataUrl(value) {
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return false;

  const base64 = match[2];
  const bytes = Math.ceil((base64.length * 3) / 4);
  return bytes <= MAX_IMAGE_BYTES;
}

function normalizeName(value) {
  if (typeof value !== "string") return "익명 손님";
  return value.trim().slice(0, 24) || "익명 손님";
}

function normalizeAvatar(value) {
  if (typeof value !== "string") return "?";
  return value.trim().slice(0, 4) || "?";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
