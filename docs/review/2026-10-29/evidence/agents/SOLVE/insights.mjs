import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOLVE";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/insights", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button[aria-pressed]")];
    const r = btns.map(b => { const x = b.getBoundingClientRect(); return { text: b.innerText, left: Math.round(x.left), right: Math.round(x.right), top: Math.round(x.top), w: Math.round(x.width), h: Math.round(x.height) }; });
    const h2 = [...document.querySelectorAll("h2")].find(h => h.innerText.includes("month"));
    const head = h2?.parentElement; const hr = head?.getBoundingClientRect();
    // find clipping ancestor
    let el = head, clip = null;
    while (el && el !== document.body) { const s = getComputedStyle(el); if (s.overflowX !== "visible") { clip = { tag: el.tagName, cls: el.className.slice(0, 120), ox: s.overflowX, sw: el.scrollWidth, cw: el.clientWidth }; break; } el = el.parentElement; }
    return { vw: innerWidth, pills: r, head: hr && { left: hr.left, right: hr.right, w: hr.width, sw: head.scrollWidth }, clip, docSW: document.documentElement.scrollWidth };
  });
  console.log(JSON.stringify(info, null, 1));
  // hide install banner to see the chart header
  await page.addStyleTag({ content: "[data-slot=install-prompt], .install-prompt {display:none!important}" });
  const h2 = page.locator("h2", { hasText: "Completions / month" });
  await h2.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "/insights-mobile-charthead.jpg", type: "jpeg", quality: 80 });
  // try horizontal scroll of the clipping region
  const after = await page.evaluate(() => { window.scrollTo(500, window.scrollY); return { sx: window.scrollX }; });
  console.log("after horizontal scroll attempt", JSON.stringify(after));
  // Focus the Solve minutes pill via keyboard focus()
  await page.locator("button[aria-pressed]", { hasText: "Solve minutes" }).focus();
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { text: document.activeElement.innerText, left: r.left, right: r.right, scrollX: window.scrollX }; });
  console.log("focused", JSON.stringify(f));
  await page.screenshot({ path: OUT + "/insights-mobile-pill-focused.jpg", type: "jpeg", quality: 80 });
  // Donut legend / sparkbar accessibility
  const donut = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll(".recharts-wrapper svg")];
    return svgs.map(s => ({ role: s.getAttribute("role"), label: s.getAttribute("aria-label"), text: s.textContent.slice(0, 80), legend: !!s.closest(".recharts-wrapper").querySelector(".recharts-legend-wrapper") }));
  });
  console.log("charts", JSON.stringify(donut, null, 1));
} finally { await context.close(); await browser.close(); }
