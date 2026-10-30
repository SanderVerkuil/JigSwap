import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MSGV";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
const r = (b) => b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
try {
  await page.goto(BASE + "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // UI-only: collapse the sidebar (layout toggle, no data write)
  await page.getByRole("button", { name: /toggle sidebar/i }).first().click();
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const opts = [...document.querySelectorAll("button[aria-label]")].filter(b => /Conversation options/i.test(b.getAttribute("aria-label"))).map(b => r(b));
    return { inset: r(document.querySelector("[data-slot=sidebar-inset]")), ta: r(document.querySelector("textarea")), h2: r([...document.querySelectorAll("h2")][0]), opts };
  });
  console.log("collapsed", JSON.stringify(m));
  await page.screenshot({ path: `${OUT}/tablet-dm-sidebar-collapsed.jpg`, type: "jpeg", quality: 70 });
  // inbox guide on tablet
  await page.goto(BASE + "/messages", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
} catch (e) { console.log("ERR", e.message); }
finally { await context.close(); await browser.close(); }
