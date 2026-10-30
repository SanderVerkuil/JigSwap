import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/DISCV";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator('input[placeholder^="Search puzzles"]').focus();
  const order = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const el = document.activeElement; const s = getComputedStyle(el);
      const card = el.closest('[data-slot="card"]'); const cs = card ? getComputedStyle(card) : null;
      return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 30)}" href=${el.getAttribute('href')} outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== "none"} textDeco=${s.textDecorationLine} cardShadow=${cs?.boxShadow?.slice(0,40)}`;
    }));
    if (i === 6) await page.screenshot({ path: `${OUT}/d_tab_card.jpg`, type: "jpeg", quality: 70 });
  }
  console.log(order.join("\n"));
  // Filters toggle aria-expanded
  const fb = page.getByRole("button", { name: "Filters" });
  console.log("filters aria-expanded:", await fb.getAttribute("aria-expanded"));
} finally { await context.close(); await browser.close(); }
