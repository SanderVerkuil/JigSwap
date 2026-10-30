import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MKT";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" };
const desktop = { viewport: { width: 1440, height: 900 }, locale: "en-US" };
// pre-set consent cookie so the banner doesn't cover things (read-only: we only set a cookie in our own context)
const consent = [{ name: "jigswap_analytics_consent", value: "denied", url: BASE }];
let ctx = await browser.newContext(mobile);
let page = await ctx.newPage();
try {
  await page.goto(BASE + "/docs/getting-started/accounts-and-sign-in", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Open documentation navigation" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "/docs-mobile-nav-sheet.jpg", type: "jpeg", quality: 75 });
  const sheetInfo = await page.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    if (!d) return null;
    const links = [...d.querySelectorAll("a")].map((a) => { const r = a.getBoundingClientRect(); return `${a.textContent.trim()}:${Math.round(r.height)}`; });
    return { count: links.length, sample: links.slice(0, 8), hasSearch: !!d.querySelector("input,button[aria-label*=earch]") };
  });
  console.log("docs sheet:", JSON.stringify(sheetInfo));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Search documentation" }).click();
  await page.waitForTimeout(600);
  await page.keyboard.type("lend", { delay: 60 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "/docs-mobile-search.jpg", type: "jpeg", quality: 75 });
  const inputFont = await page.evaluate(() => { const i = document.activeElement; return i ? `${i.tagName} ${getComputedStyle(i).fontSize}` : null; });
  console.log("search input focused:", inputFont);
  await page.keyboard.press("Escape");
} finally { await ctx.close(); }

ctx = await browser.newContext(desktop);
page = await ctx.newPage();
try {
  await page.goto(BASE + "/docs", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const vis = await page.evaluate(() => [...document.querySelectorAll("input,button")].filter((e) => e.offsetParent && /search/i.test((e.getAttribute("aria-label")||"") + (e.getAttribute("placeholder")||"") + e.textContent)).map((e) => e.tagName + ":" + (e.getAttribute("aria-label")||e.getAttribute("placeholder")||e.textContent.trim())));
  console.log("desktop /docs visible search controls:", JSON.stringify(vis));
  // Keyboard order on home: first tabs
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 28)}" outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== "none"}`; }));
  }
  console.log(order.join("\n"));
  await page.keyboard.press("Shift+Tab");
  // focus a header nav link and screenshot focus ring
  await page.locator("header nav a").first().focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  await page.screenshot({ path: OUT + "/desktop-header-focus.jpg", type: "jpeg", quality: 75, clip: { x: 0, y: 0, width: 1440, height: 90 } });
  // /browse signed-out (404 secondary CTA)
  const r = await page.goto(BASE + "/browse", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  console.log("signed-out /browse ->", page.url(), r && r.status());
} finally { await ctx.close(); await browser.close(); }
