import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOLVE";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const c = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await c.newPage();
try {
  await page.goto(BASE + "/goals", { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
  await page.addStyleTag({ content: "[data-slot=install-prompt], .install-prompt {display:none!important}" });
  await page.getByRole("button", { name: "New Goal" }).last().click();
  await page.waitForTimeout(800);
  const d = await page.evaluate(() => { const dlg = document.querySelector("[role=dialog]"); const r = dlg.getBoundingClientRect(); const b = [...dlg.querySelectorAll("button")].find(x => /Create goal/.test(x.innerText)).getBoundingClientRect(); const t = dlg.querySelector("h2").getBoundingClientRect(); return { vh: innerHeight, top: r.top, bottom: r.bottom, titleTop: t.top, btnTop: b.top, btnBottom: b.bottom, scrollable: dlg.scrollHeight > dlg.clientHeight, bodyOverflow: getComputedStyle(document.body).overflow }; });
  console.log(JSON.stringify(d));
  // try wheel scroll / touch scroll inside dialog
  await page.mouse.wheel(0, 400); await page.waitForTimeout(300);
  const d2 = await page.evaluate(() => { const dlg = document.querySelector("[role=dialog]"); const r = dlg.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, sy: scrollY }; });
  console.log("after wheel", JSON.stringify(d2));
  await page.screenshot({ path: OUT + "/goal-dialog-landscape.jpg", type: "jpeg", quality: 80 });
} finally { await c.close(); await browser.close(); }
