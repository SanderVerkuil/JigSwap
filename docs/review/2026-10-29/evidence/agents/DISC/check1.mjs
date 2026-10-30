import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/DISC";
const PID = "m9712xm5gtgnqszgq5xwvh82ph8a9hdz";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true }));
  } catch {}
});
const page = await context.newPage();
const shot = (n, full=false) => page.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 70, fullPage: full });
try {
  // 1. detail page, no install tip
  await page.goto(BASE + "/puzzles/" + PID, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("m_detail_top");
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(500);
  await shot("m_detail_mid");
  const stars = await page.evaluate(() => [...document.querySelectorAll('button[role=radio][aria-label*="star"]')].map(b => { const r = b.getBoundingClientRect(); return `${b.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
  console.log("stars:", stars.join(", "));
  const actions = await page.evaluate(() => [...document.querySelectorAll('main button, main a')].filter(e=>/Library|Swap|Review|Favorites|Suggest/.test(e.innerText)).map(e => { const r = e.getBoundingClientRect(); return `${e.innerText.trim()} @y=${Math.round(r.top+window.scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
  console.log("actions:", actions.join(" | "));

  // 2. catalogue filters panel
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.waitForTimeout(1200);
  await shot("m_puzzles_filters_open");
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(400);
  await shot("m_puzzles_filters_open2");
  // 3. search
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByPlaceholder(/Search puzzles by title/).fill("katten");
  await page.waitForTimeout(1200);
  await shot("m_puzzles_search");
  const searchInfo = await page.evaluate(() => { const i = document.querySelector('input[placeholder^="Search puzzles by title"]'); return { fontSize: getComputedStyle(i).fontSize, label: i.getAttribute('aria-label'), id: i.id, labels: i.labels?.length }; });
  console.log("search input:", JSON.stringify(searchInfo));

  // 4. browse add filter
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Add Filter" }).click();
  await page.waitForTimeout(800);
  await shot("m_browse_addfilter");
  await page.getByRole("option", { name: "Text" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Add Filter" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("option", { name: "Piece Count" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Add Filter" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("option", { name: "Availability" }).click();
  await page.waitForTimeout(600);
  await shot("m_browse_chips");
  const ov = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth, removeBtns: [...document.querySelectorAll('button[aria-label^="Remove filter"]')].map(b => { const r=b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }), pills: [...document.querySelectorAll('[aria-pressed]')].map(b=>{const r=b.getBoundingClientRect(); return `${b.innerText} ${Math.round(r.width)}x${Math.round(r.height)} right=${Math.round(r.right)}`;}) }));
  console.log("browse chips:", JSON.stringify(ov));
  const cardBtns = await page.evaluate(() => [...document.querySelectorAll('.mt-auto button')].slice(0,3).map(b => `name="${b.getAttribute('aria-label')||b.innerText||''}" title="${b.title}" ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`));
  console.log("browse card buttons:", cardBtns.join(" | "));
} finally {
  await context.close();
  await browser.close();
}
