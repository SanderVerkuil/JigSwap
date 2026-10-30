import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const link = page.locator('[data-sidebar="menu-button"][href="/my-puzzles"]');
  await link.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/my-puzzles/); await page.waitForTimeout(1500);
  console.log('url', page.url(), 'title', await page.title());
  console.log('focus after nav:', await page.evaluate(()=>{const e=document.activeElement; return e? `${e.tagName} ${(e.innerText||'').slice(0,30)} href=${e.getAttribute('href')}`:'none'}));
  // next tab goes where?
  await page.keyboard.press("Tab");
  console.log('next tab:', await page.evaluate(()=>{const e=document.activeElement; return `${e.tagName} ${(e.getAttribute('aria-label')||e.innerText||'').slice(0,30)}`}));
} finally { await context.close(); await browser.close(); }
