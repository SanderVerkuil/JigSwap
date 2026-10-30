import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.body.focus(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press("Tab"); // may land in first
  const order = [];
  for (let i = 0; i < 26; i++) {
    order.push(await page.evaluate(() => {
      const el = document.activeElement; const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 34)}" ${Math.round(r.width)}x${Math.round(r.height)} outline=${s.outlineStyle}/${s.outlineWidth} ring=${s.boxShadow !== "none"}`;
    }));
    await page.keyboard.press("Tab");
  }
  console.log(order.join("\n"));
  // focus sidebar item and screenshot focus ring
  await page.locator('a[href="/collections"]').first().focus();
  await page.screenshot({ path: "/tmp/jigswap-review/agents/SHELL/d_focus_sidebar.jpg", type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: 700, height: 300 } });
  const landmarks = await page.evaluate(() => [...document.querySelectorAll("header,nav,main,aside,[role=navigation],[role=banner],[role=main]")].map(e => `${e.tagName}${e.getAttribute("aria-label") ? "[" + e.getAttribute("aria-label") + "]" : ""} visible=${!!e.offsetParent || e.tagName==="MAIN"}`).join(" | "));
  console.log("LANDMARKS", landmarks);
} finally { await context.close(); }
await browser.close();
