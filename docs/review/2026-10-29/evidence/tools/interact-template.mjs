// Template for READ-ONLY interaction checks (copy into your own scratch dir and edit).
// Run from /tmp/jigswap-review/tools so playwright-core resolves:
//   cd /tmp/jigswap-review/tools && node /tmp/jigswap-review/agents/<you>/check.mjs
//
// Allowed: goto, scroll, hover, focus, keyboard Tab/Shift+Tab/Escape/Arrow keys, opening menus,
// popovers, drawers, sheets, dialogs and the command palette, typing into SEARCH boxes, screenshots.
// FORBIDDEN: anything that writes data. Never click buttons/links/menu items that create, save,
// send, submit, post, delete, remove, archive, accept, decline, cancel, leave, join, follow,
// unfollow, block, report, invite, request, confirm, mark read/seen, toggle a switch/checkbox, or
// upload a file. Never press Enter inside a form. If unsure whether a control writes, do not use it.
import { chromium } from "playwright-core";

const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  // desktop: { width: 1440, height: 900 }; tablet: { width: 820, height: 1180 } + isMobile/hasTouch;
  // mobile: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json", // omit for signed-out pages
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
  } catch {}
});
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // Example: open the mobile menu and screenshot it.
  // await page.getByRole("button", { name: "Open menu" }).click();
  // await page.screenshot({ path: "/tmp/jigswap-review/agents/<you>/menu.jpg", type: "jpeg", quality: 80 });

  // Example: keyboard focus order — where does focus go and is it visible?
  const order = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 30)}" outline=${s.outlineStyle}/${s.outlineWidth} ring=${s.boxShadow !== "none"}`;
      }),
    );
  }
  console.log(order.join("\n"));
} finally {
  await context.close(); // always close your own context
  await browser.close(); // over CDP this only disconnects; the shared browser keeps running
}
