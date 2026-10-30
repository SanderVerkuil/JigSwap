import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MSG";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
async function run(name, vp, fn) {
  const context = await browser.newContext({ ...vp, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  const page = await context.newPage();
  try { await fn(page); } catch (e) { console.log(name, "ERR", e.message.split("\n")[0]); }
  finally { await context.close(); }
}
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 70 });
await run("mobile-thread", MOBILE, async (page) => {
  await page.goto(`${BASE}/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  console.log("M thread", JSON.stringify(await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`; };
    const ta = document.querySelector("textarea");
    const tip = document.getElementById("install-app-tip");
    return { docH: document.documentElement.scrollHeight, vh: innerHeight, ta: r(ta), taFont: ta && getComputedStyle(ta).fontSize, enterkeyhint: ta?.getAttribute("enterkeyhint"), inputmode: ta?.getAttribute("inputmode"), tip: r(tip), tipWrap: tip && r(tip.parentElement), tabbar: r(document.querySelector('nav[aria-label]')), olH: r(document.querySelector("ol[aria-label]")), times: [...document.querySelectorAll("ol time")].map(t => t.innerText) };
  })));
  await page.getByRole("button", { name: "Conversation options" }).click();
  await page.waitForTimeout(700);
  await shot(page, "m-thread-options");
  console.log("menu items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Attach" }).click();
  await page.waitForTimeout(700);
  await shot(page, "m-attach-sheet");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // message more button
  await page.getByRole("button", { name: /More actions for message/ }).first().click();
  await page.waitForTimeout(700);
  await shot(page, "m-message-actions");
  console.log("msg items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
});
await run("mobile-inbox", MOBILE, async (page) => {
  await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /New conversation/ }).click();
  await page.waitForTimeout(800);
  await shot(page, "m-new-sheet");
  await page.getByRole("button", { name: /Circle chat/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, "m-new-sheet-circles");
  await page.keyboard.press("Escape");
});
await run("mobile-circle", MOBILE, async (page) => {
  await page.goto(`${BASE}/messages/ec1b1833-8cae-47b3-ac3c-783e276b28c9`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Conversation options" }).click();
  await page.waitForTimeout(700);
  await shot(page, "m-circle-options");
  console.log("circle items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /members/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, "m-circle-members");
});
await run("desktop", { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.goto(`${BASE}/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Conversation options" }).click();
  await page.waitForTimeout(600);
  await shot(page, "d-thread-options");
  console.log("d items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add emoji" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "d-emoji");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Attach" }).click();
  await page.waitForTimeout(600);
  await shot(page, "d-attach");
  console.log("attach items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
  // hover a message to show more
  await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /New conversation/ }).click();
  await page.waitForTimeout(600);
  await shot(page, "d-new-menu");
  console.log("new items:", await page.locator('[role="menuitem"]').allInnerTexts());
  await page.keyboard.press("Escape");
  // keyboard order from page body
  await page.locator("body").click({ position: { x: 900, y: 600 } });
  const order = [];
  for (let i = 0; i < 26; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => { const el = document.activeElement; return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g," ").slice(0, 40)}"`; }));
  }
  console.log(order.join("\n"));
});
await browser.close();
