const elements = {
  createRoom: document.querySelector("#createRoom"),
  publicRoom: document.querySelector("#publicRoom"),
  joinForm: document.querySelector("#joinForm"),
  joinRoomInput: document.querySelector("#joinRoomInput")
};

elements.createRoom.addEventListener("click", () => {
  enterRoom(`room-${Math.random().toString(36).slice(2, 8)}`);
});

elements.publicRoom.addEventListener("click", () => {
  enterRoom("public");
});

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const targetRoom = normalizeRoomInput(elements.joinRoomInput.value);
  if (!targetRoom) {
    elements.joinRoomInput.focus();
    return;
  }

  enterRoom(targetRoom);
});

function enterRoom(targetRoom) {
  location.href = `/room/${normalizeRoomInput(targetRoom)}`;
}

function normalizeRoomInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
}
