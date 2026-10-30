import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/LIB";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true })); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/my-puzzles/m572kmqqpcd0c4a106ve41fz318ge4xr", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/m-editcopy-01.jpg`, type: "jpeg", quality: 70 });
  const info = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const b = d.getBoundingClientRect();
    const btns = [...d.querySelectorAll('button')].map(x => { const r = x.getBoundingClientRect(); return `${(x.getAttribute('aria-label')||x.innerText).trim().slice(0,25)}@${Math.round(r.top)}h${Math.round(r.height)}`; });
    return { top: Math.round(b.top), h: Math.round(b.height), sh: d.scrollHeight, btns };
  });
  console.log(JSON.stringify(info));
  await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); d.scrollTop = d.scrollHeight; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m-editcopy-02.jpg`, type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape");
} catch (e) { console.error("ERR", e.message); }
finally { await context.close(); await browser.close(); }
