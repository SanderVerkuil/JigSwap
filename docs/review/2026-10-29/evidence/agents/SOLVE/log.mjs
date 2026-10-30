import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOLVE";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
async function ctx(vp) {
  const c = await browser.newContext({ ...vp, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  return c;
}
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1440, height: 900 } };
// 1. keyboard reachability of picker cards (desktop)
{
  const c = await ctx(desktop); const page = await c.newPage();
  try {
    await page.goto(BASE + "/completions/new", { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
    const cardInfo = await page.evaluate(() => {
      const h3 = [...document.querySelectorAll("h3")].find(h => h.innerText.includes("Kattenshow"));
      const card = h3?.closest("[data-slot=card]") || h3?.closest(".rounded-xl");
      return card && { tag: card.tagName, role: card.getAttribute("role"), tabIndex: card.tabIndex, hasFocusableChild: !!card.querySelector("a,button,[tabindex]") };
    });
    console.log("card", JSON.stringify(cardInfo));
    // focus search input then tab forward
    await page.locator("main input[placeholder='Search']").focus();
    const order = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => { const el = document.activeElement; return `${el.tagName} ${(el.getAttribute("aria-label")||el.innerText||"").trim().slice(0,40)}`; })); }
    console.log("tab after search:", order.join(" | "));
  } finally { await c.close(); }
}
// 2. mobile: open the log dialog by tapping the first card (opens dialog only; no save)
{
  const c = await ctx(mobile); const page = await c.newPage();
  try {
    await page.goto(BASE + "/completions/new", { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
    await page.addStyleTag({ content: "[data-slot=install-prompt], .install-prompt {display:none!important}" });
    await page.locator("h3", { hasText: "De Kattenshow" }).click();
    await page.waitForTimeout(800);
    const d = await page.evaluate(() => {
      const dlg = document.querySelector("[role=dialog]"); if (!dlg) return null;
      const r = dlg.getBoundingClientRect(); const s = getComputedStyle(dlg);
      const inputs = [...dlg.querySelectorAll("input,textarea,button")].map(i => { const ir = i.getBoundingClientRect(); return `${i.tagName}[${i.type||""}] "${(i.getAttribute("aria-label")||i.placeholder||i.innerText||i.id||"").slice(0,30)}" ${Math.round(ir.width)}x${Math.round(ir.height)} fs=${getComputedStyle(i).fontSize} top=${Math.round(ir.top)}`; });
      return { title: dlg.querySelector("h2")?.innerText, top: r.top, bottom: r.bottom, h: r.height, overflowY: s.overflowY, maxH: s.maxHeight, inputs };
    });
    console.log("log dialog", JSON.stringify(d, null, 1));
    await page.screenshot({ path: OUT + "/log-dialog-mobile.jpg", type: "jpeg", quality: 80 });
    // simulate keyboard open: shrink viewport height to ~ 844-336
    await page.setViewportSize({ width: 390, height: 508 });
    await page.locator("#solve-notes").focus();
    await page.waitForTimeout(500);
    const d2 = await page.evaluate(() => { const dlg = document.querySelector("[role=dialog]"); const r = dlg.getBoundingClientRect(); const btn = [...dlg.querySelectorAll("button")].find(b => /Save solve/.test(b.innerText)); const br = btn.getBoundingClientRect(); return { vh: innerHeight, dlgTop: r.top, dlgBottom: r.bottom, saveTop: br.top, saveBottom: br.bottom, canScroll: dlg.scrollHeight > dlg.clientHeight }; });
    console.log("short viewport", JSON.stringify(d2));
    await page.screenshot({ path: OUT + "/log-dialog-mobile-short.jpg", type: "jpeg", quality: 80 });
    await page.keyboard.press("Escape");
  } finally { await c.close(); }
}
// 3. mobile goals dialog
{
  const c = await ctx(mobile); const page = await c.newPage();
  try {
    await page.goto(BASE + "/goals", { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
    await page.addStyleTag({ content: "[data-slot=install-prompt], .install-prompt {display:none!important}" });
    await page.getByRole("button", { name: "New Goal" }).last().click();
    await page.waitForTimeout(800);
    const d = await page.evaluate(() => {
      const dlg = document.querySelector("[role=dialog]"); if (!dlg) return null;
      const r = dlg.getBoundingClientRect();
      const inputs = [...dlg.querySelectorAll("input,textarea,button")].map(i => { const ir = i.getBoundingClientRect(); return `${i.tagName}[${i.type||""}] "${(i.getAttribute("aria-label")||i.placeholder||i.innerText||i.id||"").slice(0,30)}" ${Math.round(ir.width)}x${Math.round(ir.height)} fs=${getComputedStyle(i).fontSize}`; });
      return { title: dlg.querySelector("h2")?.innerText, top: r.top, bottom: r.bottom, h: r.height, inputs };
    });
    console.log("goal dialog", JSON.stringify(d, null, 1));
    await page.screenshot({ path: OUT + "/goal-dialog-mobile.jpg", type: "jpeg", quality: 80 });
  } finally { await c.close(); }
}
await browser.close();
