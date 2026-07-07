const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
const chatServerUrl = isLocalHost ? "" : window.CHAT_SERVER_URL?.trim();
const roomId = readRoomId();
const needsServerUrl = !chatServerUrl && location.hostname.endsWith(".netlify.app");

const profileKey = "anonymous-chat-profile";
const roomProfileModeKey = "anonymous-chat-room-profile-mode";
const names = [
  "밤하늘 고래",
  "초록 유성",
  "달빛 감자",
  "은하 토끼",
  "새벽 도토리",
  "파란 여우",
  "구름 펭귄",
  "비밀 문어",
  "반짝 라마",
  "오로라 곰"
];
const avatars = ["달", "여우", "고래", "행성", "클로버", "펭귄", "부엉", "얼음", "무지개", "별"];
const themes = [
  { label: "low signal", color: "#faff69" },
  { label: "quiet mode", color: "#e6e6e6" },
  { label: "last seen", color: "#22c55e" },
  { label: "redacted", color: "#ef4444" },
  { label: "snapshot risk", color: "#3b82f6" }
];
const state = {
  profile: loadProfile(),
  image: "",
  tickTimer: null,
  isAdmin: false,
  locked: false
};
const socket = needsServerUrl || !window.io ? createOfflineSocket() : io(chatServerUrl || undefined, { auth: { room: roomId, profile: state.profile } });

const elements = {
  watermark: document.querySelector("#watermark"),
  roomName: document.querySelector("#roomName"),
  onlineCount: document.querySelector("#onlineCount"),
  lockStatus: document.querySelector("#lockStatus"),
  memberList: document.querySelector("#memberList"),
  roomProfileMode: document.querySelector("#roomProfileMode"),
  copyInvite: document.querySelector("#copyInvite"),
  myName: document.querySelector("#myName"),
  myAvatar: document.querySelector("#myAvatar"),
  myTheme: document.querySelector("#myTheme"),
  status: document.querySelector("#connectionStatus"),
  reroll: document.querySelector("#rerollProfile"),
  admin: document.querySelector("#adminMode"),
  lockRoom: document.querySelector("#lockRoom"),
  notice: document.querySelector("#notice"),
  toasts: document.querySelector("#toasts"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#messageInput"),
  imageInput: document.querySelector("#imageInput"),
  ttl: document.querySelector("#ttlInput"),
  imagePreview: document.querySelector("#imagePreview"),
  previewImg: document.querySelector("#previewImg"),
  clearImage: document.querySelector("#clearImage")
};

renderProfile();
renderRoom();
renderProfileMode();
startCountdown();

if (!roomId) {
  location.replace("/");
} else if (needsServerUrl) {
  elements.status.textContent = "Render 서버 URL 필요";
  showNotice("Netlify 프론트가 연결할 Render 서버 주소를 public/config.js에 설정해야 합니다.");
}

socket.on("connect", () => {
  elements.status.textContent = "연결됨";
});

socket.on("disconnect", () => {
  if (state.locked) return;
  elements.status.textContent = "연결 끊김";
});

socket.on("room:info", (room) => {
  renderRoomInfo(room);
});

socket.on("room:presence", (room) => {
  renderRoomInfo(room);
});

socket.on("room:lock", ({ locked }) => {
  state.locked = Boolean(locked);
  renderLockState();
  showNotice(state.locked ? "관리자가 방 입장을 잠갔습니다." : "방 입장 잠금이 해제되었습니다.");
});

socket.on("room:locked", () => {
  state.locked = true;
  elements.status.textContent = "잠긴 방";
  renderLockState();
  setComposerDisabled(true);
  showNotice("이 방은 잠겨 있어 새로 입장할 수 없습니다.");
});

socket.on("chat:init", (messages) => {
  elements.messages.replaceChildren();
  messages.forEach(renderMessage);
  scrollToBottom();
});

socket.on("chat:message", (message) => {
  renderMessage(message);
  scrollToBottom();
});

socket.on("chat:seen", ({ id, seenCount }) => {
  const target = getMessage(id)?.querySelector(".seen-count");
  if (target) target.textContent = `${seenCount}명이 봄`;
});

socket.on("chat:reaction", ({ id, reactions }) => {
  updateReactions(id, reactions);
});

socket.on("chat:delete", (id) => {
  getMessage(id)?.remove();
});

socket.on("chat:clear", () => {
  elements.messages.replaceChildren();
  showNotice("관리자가 방을 초기화했습니다.");
});

socket.on("chat:notice", showNotice);

elements.copyInvite.addEventListener("click", async () => {
  await navigator.clipboard.writeText(getInviteUrl());
  showNotice("초대 링크를 복사했습니다.");
});

elements.reroll.addEventListener("click", () => {
  state.profile = createProfile();
  saveProfile(state.profile);
  renderProfile();
  socket.emit("profile:update", { profile: state.profile });
  showNotice("새 익명 프로필을 뽑았습니다.");
});

elements.roomProfileMode.addEventListener("change", () => {
  localStorage.setItem(roomProfileModeKey, elements.roomProfileMode.checked ? "room" : "global");
  saveProfile(createProfile());
  location.reload();
});

elements.admin.addEventListener("click", () => {
  if (state.isAdmin) {
    if (!confirm("이 방의 모든 메시지를 삭제할까요?")) return;
    socket.emit("admin:clear", {}, handleAck("방을 초기화했습니다."));
    return;
  }

  const password = prompt("관리자 비밀번호를 입력하세요.");
  if (!password) return;

  socket.emit("admin:auth", { password }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "관리자 인증에 실패했습니다.");
      return;
    }

    state.isAdmin = true;
    document.body.classList.add("admin-active");
    elements.lockRoom.hidden = false;
    elements.admin.textContent = "방 초기화";
    showNotice("관리자 모드가 켜졌습니다.");
  });
});

elements.lockRoom.addEventListener("click", () => {
  socket.emit("admin:lock", { locked: !state.locked }, (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "방 잠금을 바꿀 수 없습니다.");
      return;
    }

    state.locked = response.locked;
    renderLockState();
    showNotice(state.locked ? "방을 잠갔습니다." : "방 잠금을 해제했습니다.");
  });
});

elements.imageInput.addEventListener("change", async () => {
  const file = elements.imageInput.files?.[0];
  if (!file) return;

  if (!file.type.match(/^image\/(png|jpeg|gif|webp)$/) || file.size > 900 * 1024) {
    showNotice("사진은 900KB 이하의 PNG, JPG, GIF, WebP만 가능합니다.");
    elements.imageInput.value = "";
    return;
  }

  state.image = await readAsDataUrl(file);
  elements.previewImg.src = state.image;
  elements.imagePreview.hidden = false;
});

elements.clearImage.addEventListener("click", clearImage);

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = elements.input.value.trim();
  if (!text && !state.image) {
    showNotice("메시지나 사진을 입력해 주세요.");
    return;
  }

  elements.form.querySelector("button[type='submit']").disabled = true;

  socket.emit(
    "chat:send",
    {
      name: state.profile.name,
      avatar: state.profile.avatar,
      theme: state.profile.theme,
      text,
      image: state.image,
      ttlSeconds: Number(elements.ttl.value)
    },
    (response) => {
      elements.form.querySelector("button[type='submit']").disabled = false;
      if (!response?.ok) {
        showNotice(response?.error || "메시지를 보낼 수 없습니다.");
        return;
      }

      elements.input.value = "";
      clearImage();
      elements.input.focus();
    }
  );
});

function renderMessage(message) {
  if (Date.now() >= message.expiresAt) return;

  const existing = getMessage(message.id);
  if (existing) existing.remove();

  const row = document.createElement("article");
  row.className = `message ${message.senderId === socket.id ? "own" : ""}`;
  row.dataset.messageId = message.id;
  row.dataset.createdAt = String(message.createdAt);
  row.dataset.expiresAt = String(message.expiresAt);

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.avatar;
  avatar.style.backgroundColor = message.theme?.color || "#faff69";

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<strong></strong><span class="seen-count"></span><span class="time-left"></span>`;
  meta.querySelector("strong").textContent = message.name;
  meta.querySelector(".seen-count").textContent = `${message.seenCount || 0}명이 봄`;
  body.append(meta);

  const theme = document.createElement("div");
  theme.className = "message-theme";
  theme.textContent = message.theme?.label || "unknown";
  body.append(theme);

  if (message.text) {
    const text = document.createElement("p");
    text.textContent = message.text;
    body.append(text);
  }

  if (message.image) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "image-lock locked";

    const image = document.createElement("img");
    image.className = "message-img";
    image.src = message.image;
    image.alt = `${message.name}이 보낸 사진`;

    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.textContent = "사진 보기";
    reveal.addEventListener("click", () => imageWrap.classList.remove("locked"));

    imageWrap.append(image, reveal);
    body.append(imageWrap);
  }

  const reactionBar = document.createElement("div");
  reactionBar.className = "reaction-bar";

  const reactionList = document.createElement("div");
  reactionList.className = "reaction-list";
  reactionBar.append(reactionList);

  const addReaction = document.createElement("button");
  addReaction.type = "button";
  addReaction.className = "add-reaction";
  addReaction.textContent = "+ 이모지";
  addReaction.addEventListener("click", () => {
    const emoji = prompt("달 이모지를 입력하세요. 예: 🔥");
    if (!emoji) return;
    socket.emit("chat:react", { id: message.id, emoji: emoji.trim() });
  });
  reactionBar.append(addReaction);
  body.append(reactionBar);

  const adminDelete = document.createElement("button");
  adminDelete.type = "button";
  adminDelete.className = "admin-delete";
  adminDelete.textContent = "관리자 삭제";
  adminDelete.addEventListener("click", () => {
    socket.emit("admin:delete", { id: message.id }, handleAck("메시지를 삭제했습니다."));
  });
  body.append(adminDelete);

  const expiry = document.createElement("div");
  expiry.className = "expiry-bar";
  expiry.append(document.createElement("span"));
  body.append(expiry);

  row.append(avatar, body);
  elements.messages.append(row);
  updateReactions(message.id, message.reactions || {});
  updateCountdown(row);
  socket.emit("chat:seen", { id: message.id });
}

function startCountdown() {
  state.tickTimer = setInterval(() => {
    document.querySelectorAll("[data-expires-at]").forEach(updateCountdown);
  }, 500);
}

function updateCountdown(row) {
  const createdAt = Number(row.dataset.createdAt);
  const expiresAt = Number(row.dataset.expiresAt);
  const left = Math.ceil((expiresAt - Date.now()) / 1000);
  if (left <= 0) {
    row.remove();
    return;
  }

  const total = Math.max(1, expiresAt - createdAt);
  const progress = Math.max(0, Math.min(1, (expiresAt - Date.now()) / total));
  row.style.setProperty("--progress", progress.toFixed(3));

  const target = row.querySelector(".time-left");
  target.textContent = `${left}초 뒤 사라짐`;
  target.classList.toggle("expires-soon", left <= 5);
}

function updateReactions(id, counts) {
  const row = getMessage(id);
  if (!row) return;

  const list = row.querySelector(".reaction-list");
  list.replaceChildren();

  Object.entries(counts).forEach(([emoji, count]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.emoji = emoji;
    button.textContent = `${emoji} ${count}`;
    button.addEventListener("click", () => socket.emit("chat:react", { id, emoji }));
    list.append(button);
  });
}

function loadProfile() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(getActiveProfileKey()));
    if (saved?.name && saved?.avatar && saved?.theme) return saved;
  } catch (_error) {
    sessionStorage.removeItem(getActiveProfileKey());
  }

  const profile = createProfile();
  saveProfile(profile);
  return profile;
}

function saveProfile(profile) {
  sessionStorage.setItem(getActiveProfileKey(), JSON.stringify(profile));
}

function getActiveProfileKey() {
  return localStorage.getItem(roomProfileModeKey) === "room" ? `${profileKey}:${roomId}` : profileKey;
}

function createProfile() {
  return {
    name: `${pick(names)} #${Math.floor(100 + Math.random() * 900)}`,
    avatar: pick(avatars),
    theme: pick(themes)
  };
}

function renderProfile() {
  elements.myName.textContent = state.profile.name;
  elements.myAvatar.textContent = state.profile.avatar;
  elements.myAvatar.style.backgroundColor = state.profile.theme.color;
  elements.myTheme.textContent = state.profile.theme.label;
  elements.watermark.textContent = `${state.profile.name} / ${roomId}`;
}

function renderRoom() {
  elements.roomName.textContent = `room: ${roomId}`;
  document.title = `채팅방 | ${roomId}`;
}

function renderRoomInfo(room) {
  state.locked = Boolean(room.locked);
  elements.roomName.textContent = `room: ${room.roomId}`;
  elements.onlineCount.textContent = `${room.memberCount}명 접속`;
  renderLockState();
  renderMembers(room.members || []);
}

function renderProfileMode() {
  elements.roomProfileMode.checked = localStorage.getItem(roomProfileModeKey) === "room";
}

function renderLockState() {
  elements.lockStatus.textContent = state.locked ? "입장 잠김" : "입장 가능";
  elements.lockStatus.classList.toggle("locked", state.locked);
  elements.lockRoom.textContent = state.locked ? "잠금 해제" : "방 잠금";
}

function renderMembers(members) {
  elements.memberList.replaceChildren();
  members.forEach((member) => {
    const item = document.createElement("li");
    const avatar = document.createElement("span");
    const name = document.createElement("strong");
    const theme = document.createElement("em");

    avatar.textContent = member.avatar;
    avatar.style.backgroundColor = member.theme?.color || "#faff69";
    name.textContent = member.name;
    theme.textContent = member.theme?.label || "unknown";

    item.append(avatar, name, theme);
    elements.memberList.append(item);
  });
}

function clearImage() {
  state.image = "";
  elements.imageInput.value = "";
  elements.previewImg.removeAttribute("src");
  elements.imagePreview.hidden = true;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showNotice(text) {
  elements.notice.textContent = text;
  showToast(text);
  setTimeout(() => {
    if (elements.notice.textContent === text) elements.notice.textContent = "";
  }, 3000);
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  elements.toasts.append(toast);
  setTimeout(() => toast.remove(), 3600);
}

function setComposerDisabled(disabled) {
  elements.input.disabled = disabled;
  elements.imageInput.disabled = disabled;
  elements.ttl.disabled = disabled;
  elements.form.querySelector("button[type='submit']").disabled = disabled;
}

function handleAck(successText) {
  return (response) => {
    if (!response?.ok) {
      showNotice(response?.error || "요청을 처리할 수 없습니다.");
      return;
    }

    showNotice(successText);
  };
}

function getMessage(id) {
  return document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function readRoomId() {
  const match = location.pathname.match(/^\/room\/([a-z0-9-]{3,32})/i);
  return match ? match[1].toLowerCase() : "";
}

function getInviteUrl() {
  return `${location.origin}/room/${roomId}`;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function createOfflineSocket() {
  return {
    id: "offline",
    on() {},
    emit(_event, _payload, ack) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Render 서버 URL이 아직 설정되지 않았습니다." });
      }
    }
  };
}
