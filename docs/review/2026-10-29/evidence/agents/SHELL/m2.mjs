import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
for (const [lang, vp] of [["en", 390], ["nl", 390], ["en", 820]]) {
  const context = await browser.newContext({
    viewport: { width: vp, height: vp === 390 ? 844 : 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    storageState: "/tmp/jigswap-review/tools/auth.json",
  });
  await context.addCookies([{ name: "jigswap-intl", value: lang, url: BASE }]);
  await context.addInitScript(() => { try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    sessionStorage.setItem("jigswap.installTip.shown", "1");
    sessionStorage.setItem("jigswap.installTip.counted", "1"); } catch {} });
  const page = await context.newPage();
  try {
    for (const route of ["/notifications", "/my-puzzles", "/people", "/circles", "/goals", "/collections", "/completions", "/household", "/trades", "/browse", "/puzzles"]) {
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      const info = await page.evaluate((vp) => {
        // mobile actions row: first child of content area with md:hidden + justify-end
        const sel = vp < 768 ? 'main div.justify-end.md\\:hidden' : 'main div.sticky.top-0';
        const row = document.querySelector(sel);
        if (!row) return "no row";
        const out = [];
        row.querySelectorAll("*").forEach((el) => {
          if (el.children.length === 0 || el.tagName === "BUTTON" || el.tagName === "A") {
            const r = el.getBoundingClientRect();
            const txt = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30);
            if (txt && (r.left < 0 || r.right > window.innerWidth)) out.push(`${el.tagName}"${txt}" L=${Math.round(r.left)} R=${Math.round(r.right)}`);
          }
        });
        const h1 = document.querySelector("main h1");
        const h1r = h1 ? h1.getBoundingClientRect() : null;
        return (out.length ? "OFFSCREEN: " + out.join(" ; ") : "ok") + (vp >= 768 && h1r ? ` h1w=${Math.round(h1r.width)} h1scroll=${h1.scrollWidth}` : "");
      }, vp);
      console.log(lang, vp, route, info);
    }
  } finally { await context.close(); }
}
await browser.close();
