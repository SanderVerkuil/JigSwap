// READ-ONLY: desktop /notifications/preferences — scroll and hit-test switches under the sticky aside.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/notifications/preferences", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const r = document.querySelector('[data-scroll-restoration-id="app-content"]'); r.scrollTop = 700; });
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const ar = aside.getBoundingClientRect();
    const grid = aside.parentElement;
    const out = { aside: { t: Math.round(ar.top), b: Math.round(ar.bottom), l: Math.round(ar.left), r: Math.round(ar.right), pos: getComputedStyle(aside).position }, gridCols: getComputedStyle(grid).gridTemplateColumns, gridW: grid.clientWidth, hits: [] };
    for (const sw of document.querySelectorAll('[role="switch"]')) {
      const r = sw.getBoundingClientRect();
      if (r.top < ar.top || r.bottom > ar.bottom || r.width === 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      out.hits.push({ y: Math.round(cy), x: Math.round(cx), hitIsSwitch: sw === hit || sw.contains(hit), hitTag: hit?.tagName, hitInAside: aside.contains(hit) });
    }
    // jump-to links: are they the topmost element at their center?
    out.jump = [...aside.querySelectorAll("nav a")].map((a) => { const r = a.getBoundingClientRect(); const h = document.elementFromPoint(r.left + 5, r.top + r.height / 2); return { t: a.textContent, top: Math.round(r.top), topmost: h === a || a.contains(h) }; });
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  await page.screenshot({ path: "/tmp/jigswap-review/agents/SOCV/d-prefs-700.jpg", type: "jpeg", quality: 70 });
} finally { await context.close(); await browser.close(); }
