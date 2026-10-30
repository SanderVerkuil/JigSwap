// READ-ONLY verification: navigation, focus, Tab, opening dialogs, taps on charts, screenshots. No writes.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOLVE-verify";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const auth = "/tmp/jigswap-review/tools/auth.json";
async function mk(opts) {
  const c = await browser.newContext({ storageState: auth, locale: "en-GB", ...opts });
  await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  return c;
}
const hideInstall = "[data-slot=install-prompt], .install-prompt {display:none!important}";
// A. desktop keyboard on /completions/new
{
  const c = await mk({ viewport: { width: 1440, height: 900 } });
  const page = await c.newPage();
  try {
    await page.goto(BASE + "/completions/new", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const cards = await page.evaluate(() => [...document.querySelectorAll("[data-slot=card]")].map(card => ({
      tag: card.tagName, role: card.getAttribute("role"), tabIndex: card.tabIndex,
      focusables: [...card.querySelectorAll("a,button,input,[tabindex]")].map(e => e.tagName + ":" + e.tabIndex),
      title: card.querySelector("h3")?.innerText,
    })));
    console.log("A cards", JSON.stringify(cards));
    await page.locator("main input").first().focus();
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => { const el = document.activeElement; return `${el.tagName}${el.getAttribute("role") ? "[" + el.getAttribute("role") + "]" : ""} "${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 30)}"`; }));
    }
    console.log("A tab after search:", order.join(" | "));
  } finally { await c.close(); }
}
// B. mobile insights pills EN + NL
for (const loc of ["en", "nl"]) {
  const st = JSON.parse(await (await import("fs")).promises.readFile(auth, "utf8"));
  st.cookies = st.cookies.filter(x => x.name !== "jigswap-intl");
  st.cookies.push({ name: "jigswap-intl", value: loc, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" });
  const c = await browser.newContext({ storageState: st, locale: loc === "nl" ? "nl-NL" : "en-GB", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  const page = await c.newPage();
  try {
    await page.goto(BASE + "/insights", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: hideInstall });
    const info = await page.evaluate(() => {
      const pills = [...document.querySelectorAll("button[aria-pressed]")].map(b => { const r = b.getBoundingClientRect(); return `${b.innerText} L${Math.round(r.left)} R${Math.round(r.right)} H${Math.round(r.height)}`; });
      const h2 = document.querySelector("button[aria-pressed]")?.closest("section")?.querySelector("h2");
      const head = h2?.parentElement;
      return { vw: innerWidth, pills, h2: h2?.innerText, headW: head?.clientWidth, headSW: head?.scrollWidth };
    });
    console.log("B", loc, JSON.stringify(info));
    const h2 = page.locator("button[aria-pressed]").first();
    await h2.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/insights-head-${loc}.jpg`, type: "jpeg", quality: 70 });
    if (loc === "en") {
      // C. tap the donut and look for a tooltip
      const donut = page.locator(".recharts-pie").first();
      if (await donut.count()) {
        await donut.scrollIntoViewIfNeeded();
        const box = await donut.boundingBox();
        await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.5);
        await page.waitForTimeout(500);
        const tt = await page.evaluate(() => [...document.querySelectorAll(".recharts-tooltip-wrapper")].map(w => ({ vis: getComputedStyle(w).visibility, text: w.innerText.slice(0, 60) })));
        const svgs = await page.evaluate(() => [...document.querySelectorAll(".recharts-wrapper svg.recharts-surface")].map(s => ({ role: s.getAttribute("role"), label: s.getAttribute("aria-label"), legend: !!s.closest(".recharts-wrapper").querySelector(".recharts-legend-wrapper") })));
        console.log("C tooltip after tap", JSON.stringify(tt), "svgs", JSON.stringify(svgs));
        await page.screenshot({ path: `${OUT}/donut-tap-mobile.jpg`, type: "jpeg", quality: 70 });
      }
    }
  } finally { await c.close(); }
}
// D. landscape phone: open the Log a solve dialog (opening only, no save)
{
  const c = await mk({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await c.newPage();
  try {
    await page.goto(BASE + "/completions/new", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.addStyleTag({ content: hideInstall });
    await page.locator("[data-slot=card] h3").first().click();
    await page.waitForTimeout(800);
    const d = await page.evaluate(() => {
      const dlg = document.querySelector("[role=dialog]"); if (!dlg) return null;
      const r = dlg.getBoundingClientRect(); const s = getComputedStyle(dlg);
      const save = [...dlg.querySelectorAll("button")].find(b => /Save solve/.test(b.innerText))?.getBoundingClientRect();
      const close = dlg.querySelector("[data-slot=dialog-close]")?.getBoundingClientRect();
      const title = dlg.querySelector("h2")?.getBoundingClientRect();
      return { vh: innerHeight, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), overflowY: s.overflowY, maxH: s.maxHeight, titleTop: title && Math.round(title.top), saveTop: save && Math.round(save.top), saveBottom: save && Math.round(save.bottom), close: close && `${Math.round(close.width)}x${Math.round(close.height)}`, bodyOverflow: getComputedStyle(document.body).overflow };
    });
    console.log("D landscape log dialog", JSON.stringify(d));
    await page.screenshot({ path: `${OUT}/log-dialog-landscape.jpg`, type: "jpeg", quality: 70 });
    // try to scroll it
    await page.touchscreen.tap(420, 200).catch(() => {});
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);
    const d2 = await page.evaluate(() => { const dlg = document.querySelector("[role=dialog]"); if (!dlg) return "closed"; const r = dlg.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), sy: scrollY }; });
    console.log("D after wheel", JSON.stringify(d2));
  } finally { await c.close(); }
}
await browser.close();
