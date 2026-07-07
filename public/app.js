const chatServerUrl = window.CHAT_SERVER_URL?.trim();
const needsServerUrl = !chatServerUrl && location.hostname.endsWith(".netlify.app");
const socket = needsServerUrl || !window.io ? createOfflineSocket() : io(chatServerUrl || undefined);

const profileKey = "anonymous-chat-profile";
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
const avatars = ["🌙", "🦊", "🐳", "🪐", "🍀", "🐧", "🦉", "🧊", "🌈", "⭐"];

const state = {
  profile: loadProfile(),
  image: "",
  tickTimer: null
};

const elements = {
  myName: document.querySelector("#myName"),
  myAvatar: document.querySelector("#myAvatar"),
  status: document.querySelector("#connectionStatus"),
  reroll: document.querySelector("#rerollProfile"),
  notice: document.querySelector("#notice"),
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
startCountdown();

if (needsServerUrl) {
  elements.status.textContent = "Render 서버 URL 필요";
  showNotice("Netlify 프론트가 연결할 Render 서버 주소를 public/config.js에 설정해야 합니다.");
}

socket.on("connect", () => {
  elements.status.textContent = "연결됨";
});

socket.on("disconnect", () => {
  elements.status.textContent = "연결 끊김";
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

socket.on("chat:delete", (id) => {
  document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.remove();
});

socket.on("chat:notice", (text) => {
  elements.notice.textContent = text;
  setTimeout(() => {
    if (elements.notice.textContent === text) elements.notice.textContent = "";
  }, 2500);
});

elements.reroll.addEventListener("click", () => {
  state.profile = createProfile();
  localStorage.setItem(profileKey, JSON.stringify(state.profile));
  renderProfile();
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

  const existing = document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (existing) existing.remove();

  const row = document.createElement("article");
  row.className = `message ${message.senderId === socket.id ? "own" : ""}`;
  row.dataset.messageId = message.id;
  row.dataset.expiresAt = String(message.expiresAt);

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = message.avatar;

  const body = document.createElement("div");
  body.className = "message-body";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.innerHTML = `<strong></strong><span class="time-left"></span>`;
  meta.querySelector("strong").textContent = message.name;

  body.append(meta);

  if (message.text) {
    const text = document.createElement("p");
    text.textContent = message.text;
    body.append(text);
  }

  if (message.image) {
    const image = document.createElement("img");
    image.className = "message-img";
    image.src = message.image;
    image.alt = `${message.name}이 보낸 사진`;
    body.append(image);
  }

  row.append(avatar, body);
  elements.messages.append(row);
  updateCountdown(row);
}

function startCountdown() {
  state.tickTimer = setInterval(() => {
    document.querySelectorAll("[data-expires-at]").forEach(updateCountdown);
  }, 500);
}

function updateCountdown(row) {
  const left = Math.ceil((Number(row.dataset.expiresAt) - Date.now()) / 1000);
  if (left <= 0) {
    row.remove();
    return;
  }

  const target = row.querySelector(".time-left");
  target.textContent = `${left}초 뒤 사라짐`;
  target.classList.toggle("expires-soon", left <= 5);
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(profileKey));
    if (saved?.name && saved?.avatar) return saved;
  } catch (_error) {
    localStorage.removeItem(profileKey);
  }

  const profile = createProfile();
  localStorage.setItem(profileKey, JSON.stringify(profile));
  return profile;
}

function createProfile() {
  return {
    name: `${pick(names)} #${Math.floor(100 + Math.random() * 900)}`,
    avatar: pick(avatars)
  };
}

function renderProfile() {
  elements.myName.textContent = state.profile.name;
  elements.myAvatar.textContent = state.profile.avatar;
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
  setTimeout(() => {
    if (elements.notice.textContent === text) elements.notice.textContent = "";
  }, 3000);
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
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
