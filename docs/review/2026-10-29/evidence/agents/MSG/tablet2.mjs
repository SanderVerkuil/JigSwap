import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MSG";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  for (const id of ["04e0cd32-b61f-48f9-98e1-c25d9de34c28", "ec1b1833-8cae-47b3-ac3c-783e276b28c9"]) {
    await page.goto(`${BASE}/messages/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log(id.slice(0,4), JSON.stringify(await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return `x=${Math.round(b.x)} right=${Math.round(b.right)} w=${Math.round(b.width)} h=${Math.round(b.height)}`; };
      const opt = document.querySelector('button[aria-label="Conversation options"]');
      const inset = document.querySelector('main') ;
      const send = document.querySelector('button[aria-label="Send message"]');
      const attach = document.querySelector('button[aria-label="Attach"]');
      const emoji = document.querySelector('button[aria-label="Add emoji"]');
      const vp = document.querySelector('a[href="/my-puzzles"]');
      return { options: r(opt), main: r(inset), send: r(send), attach: r(attach), emoji: r(emoji), sidebarState: document.querySelector('[data-state][data-collapsible]')?.getAttribute('data-state') };
    })));
  }
  // collapse sidebar (UI-only toggle, persisted in cookie) — instead just measure what icon mode would yield
} finally { await context.close(); await browser.close(); }
