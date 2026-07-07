const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 900 * 1024;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 120;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin-vanish";
const REACTIONS = new Set(["ㅋㅋ", "좋아요", "놀람", "비밀"]);
const MESSAGE_STYLES = new Set(["normal", "whisper", "question", "warning"]);

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

const rooms = new Map();
const cleanupTimers = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/room/:roomId", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  const roomId = normalizeRoom(socket.handshake.auth?.room || socket.handshake.query?.room);
  const room = getRoom(roomId);

  socket.data.roomId = roomId;
  socket.join(roomId);
  room.members.add(socket.id);

  socket.emit("room:info", { roomId, memberCount: room.members.size });
  socket.emit("chat:init", getVisibleMessages(room));
  emitPresence(roomId);
  socket.to(roomId).emit("chat:notice", "익명 사용자가 들어왔습니다.");

  socket.on("chat:send", (payload, ack) => {
    const activeRoom = getSocketRoom(socket);
    const result = createMessage(socket.id, payload);

    if (!result.ok) {
      if (typeof ack === "function") ack({ ok: false, error: result.error });
      return;
    }

    activeRoom.messages.set(result.message.id, result.message);
    activeRoom.seen.set(result.message.id, new Set([socket.id]));
    activeRoom.reactions.set(result.message.id, new Map());
    scheduleExpiry(socket.data.roomId, result.message.id, result.message.expiresAt);

    io.to(socket.data.roomId).emit("chat:message", serializeMessage(activeRoom, result.message));

    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("chat:seen", (payload = {}) => {
    const activeRoom = getSocketRoom(socket);
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!activeRoom.messages.has(id)) return;

    const viewers = activeRoom.seen.get(id) || new Set();
    viewers.add(socket.id);
    activeRoom.seen.set(id, viewers);
    io.to(socket.data.roomId).emit("chat:seen", { id, seenCount: viewers.size });
  });

  socket.on("chat:react", (payload = {}) => {
    const activeRoom = getSocketRoom(socket);
    const id = typeof payload.id === "string" ? payload.id : "";
    const emoji = typeof payload.emoji === "string" ? payload.emoji : "";
    if (!activeRoom.messages.has(id) || !REACTIONS.has(emoji)) return;

    const reactions = activeRoom.reactions.get(id) || new Map();
    const reactors = reactions.get(emoji) || new Set();

    if (reactors.has(socket.id)) {
      reactors.delete(socket.id);
    } else {
      reactors.add(socket.id);
    }

    reactions.set(emoji, reactors);
    activeRoom.reactions.set(id, reactions);
    io.to(socket.data.roomId).emit("chat:reaction", { id, reactions: serializeReactions(reactions) });
  });

  socket.on("admin:auth", (payload = {}, ack) => {
    const password = typeof payload.password === "string" ? payload.password : "";
    if (password !== ADMIN_PASSWORD) {
      if (typeof ack === "function") ack({ ok: false, error: "관리자 비밀번호가 맞지 않습니다." });
      return;
    }

    const activeRoom = getSocketRoom(socket);
    activeRoom.admins.add(socket.id);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:delete", (payload = {}, ack) => {
    const activeRoom = getSocketRoom(socket);
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!activeRoom.admins.has(socket.id)) {
      if (typeof ack === "function") ack({ ok: false, error: "관리자 권한이 필요합니다." });
      return;
    }

    deleteMessage(socket.data.roomId, id);
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("admin:clear", (_payload, ack) => {
    const activeRoom = getSocketRoom(socket);
    if (!activeRoom.admins.has(socket.id)) {
      if (typeof ack === "function") ack({ ok: false, error: "관리자 권한이 필요합니다." });
      return;
    }

    for (const id of activeRoom.messages.keys()) {
      const timer = cleanupTimers.get(id);
      if (timer) clearTimeout(timer);
      cleanupTimers.delete(id);
    }

    activeRoom.messages.clear();
    activeRoom.seen.clear();
    activeRoom.reactions.clear();
    io.to(socket.data.roomId).emit("chat:clear");
    if (typeof ack === "function") ack({ ok: true });
  });

  socket.on("disconnect", () => {
    const activeRoom = getSocketRoom(socket);
    activeRoom.members.delete(socket.id);
    activeRoom.admins.delete(socket.id);
    socket.to(socket.data.roomId).emit("chat:notice", "익명 사용자가 나갔습니다.");
    emitPresence(socket.data.roomId);
  });
});

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      messages: new Map(),
      members: new Set(),
      admins: new Set(),
      seen: new Map(),
      reactions: new Map()
    });
  }

  return rooms.get(roomId);
}

function getSocketRoom(socket) {
  return getRoom(socket.data.roomId || "lobby");
}

function getVisibleMessages(room) {
  const now = Date.now();
  return Array.from(room.messages.values())
    .filter((message) => message.expiresAt > now)
    .map((message) => serializeMessage(room, message));
}

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
  const style = MESSAGE_STYLES.has(payload.style) ? payload.style : "normal";

  return {
    ok: true,
    message: {
      id,
      senderId: socketId,
      name: normalizeName(payload.name),
      avatar: normalizeAvatar(payload.avatar),
      theme: normalizeTheme(payload.theme),
      style,
      text,
      image,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000
    }
  };
}

function serializeMessage(room, message) {
  return {
    ...message,
    seenCount: room.seen.get(message.id)?.size || 0,
    reactions: serializeReactions(room.reactions.get(message.id))
  };
}

function serializeReactions(reactions = new Map()) {
  return Object.fromEntries(
    Array.from(reactions.entries())
      .map(([emoji, users]) => [emoji, users.size])
      .filter(([, count]) => count > 0)
  );
}

function scheduleExpiry(roomId, id, expiresAt) {
  const delay = Math.max(0, expiresAt - Date.now());
  const timer = setTimeout(() => {
    deleteMessage(roomId, id);
  }, delay);

  cleanupTimers.set(id, timer);
}

function deleteMessage(roomId, id) {
  const room = getRoom(roomId);
  const existed = room.messages.delete(id);
  room.seen.delete(id);
  room.reactions.delete(id);

  const timer = cleanupTimers.get(id);
  if (timer) clearTimeout(timer);
  cleanupTimers.delete(id);

  if (existed) io.to(roomId).emit("chat:delete", id);
}

function emitPresence(roomId) {
  const room = getRoom(roomId);
  io.to(roomId).emit("room:presence", { roomId, memberCount: room.members.size });
}

function isValidImageDataUrl(value) {
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return false;

  const base64 = match[2];
  const bytes = Math.ceil((base64.length * 3) / 4);
  return bytes <= MAX_IMAGE_BYTES;
}

function normalizeRoom(value) {
  if (typeof value !== "string") return "lobby";
  const room = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
  return room || "lobby";
}

function normalizeName(value) {
  if (typeof value !== "string") return "익명 손님";
  return value.trim().slice(0, 24) || "익명 손님";
}

function normalizeAvatar(value) {
  if (typeof value !== "string") return "?";
  return value.trim().slice(0, 4) || "?";
}

function normalizeTheme(value) {
  if (!value || typeof value !== "object") return { label: "unknown", color: "#faff69" };
  return {
    label: typeof value.label === "string" ? value.label.slice(0, 20) : "unknown",
    color: typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#faff69"
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
