import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
try {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // Cookie banner button names (read only, do not click)
  const cb = await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => /Decline|Accept/.test(b.textContent)).map(b => ({ text: b.textContent, h: b.getBoundingClientRect().height, z: getComputedStyle(b.closest(".fixed")||b).zIndex, role: (b.closest(".fixed")||{}).getAttribute?.("role") })));
  console.log("cookie buttons:", JSON.stringify(cb));
  const snap = await page.locator("div.fixed").filter({ hasText: "cookie" }).first().ariaSnapshot().catch(e => "ERR " + e.message);
  console.log("cookie banner aria:\n" + snap);
  // Mobile menu toggle
  const tog = page.getByRole("button", { name: "Open menu" });
  console.log("aria-expanded before:", await tog.getAttribute("aria-expanded"));
  await tog.click();
  await page.waitForTimeout(300);
  const tog2 = page.getByRole("button", { name: "Close menu" });
  console.log("aria-expanded after:", await tog2.getAttribute("aria-expanded"), "focus:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("menu still open after Escape:", await page.getByRole("button", { name: "Close menu" }).count() > 0);
  // Catalog comboboxes
  await page.goto(BASE + "/catalog", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  console.log("catalog main aria:\n" + (await page.locator("main").ariaSnapshot()).split("\n").slice(0, 8).join("\n"));
  console.log("errors:", errors);
} finally {
  await context.close();
  await browser.close();
}
