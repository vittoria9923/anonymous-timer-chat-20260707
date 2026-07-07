const { test, expect } = require("@playwright/test");

test("landing page offers entry choices", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "몇 초 뒤 사라지는 익명 채팅." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "어떤 방식으로 들어갈까요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "방 개설" })).toBeVisible();
  await expect(page.getByRole("button", { name: "공개방 참가" })).toBeVisible();
});

test("public room supports realtime message, reactions, admin delete, and expiry", async ({ browser }) => {
  const room = `e2e-${Date.now()}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto(`/room/${room}`);
  await pageB.goto(`/room/${room}`);

  await expect(pageA.locator("#roomName")).toHaveText(`room: ${room}`);
  await expect(pageA.locator("#onlineCount")).toContainText("2명 접속");
  await expect(pageB.locator("#onlineCount")).toContainText("2명 접속");

  await pageA.locator("#ttlInput").selectOption("5");
  await pageA.locator("#styleInput").selectOption("question");
  await pageA.locator("#messageInput").fill("e2e disappearing question");
  await pageA.getByRole("button", { name: "보내기" }).click();

  const messageOnA = pageA.locator(".message", { hasText: "e2e disappearing question" });
  const messageOnB = pageB.locator(".message", { hasText: "e2e disappearing question" });
  await expect(messageOnB).toBeVisible();
  await expect(messageOnB.locator(".style-label")).toHaveText("질문");
  await expect(messageOnA.locator(".seen-count")).toContainText("2명이 봄");

  await messageOnB.getByRole("button", { name: /좋아요/ }).click();
  await expect(messageOnA.getByRole("button", { name: /좋아요 1/ })).toBeVisible();

  pageA.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("관리자 비밀번호");
    await dialog.accept("admin-vanish");
  });
  await pageA.getByRole("button", { name: "관리자" }).click();
  await expect(pageA.locator("#notice")).toHaveText("관리자 모드가 켜졌습니다.");
  await messageOnA.getByRole("button", { name: "관리자 삭제" }).click();
  await expect(messageOnB).toBeHidden();

  await pageA.locator("#messageInput").fill("short lived");
  await pageA.getByRole("button", { name: "보내기" }).click();
  await expect(pageB.locator(".message", { hasText: "short lived" })).toBeVisible();
  await expect(pageB.locator(".message", { hasText: "short lived" })).toBeHidden({ timeout: 8_000 });

  await contextA.close();
  await contextB.close();
});
