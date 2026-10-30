import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/DISCV";
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
try {
  // Catalogue: search + list view, open a card, go back
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search puzzles by title/).fill("haasteren");
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => ({ q: document.querySelector('input[placeholder^="Search puzzles"]').value, cards: document.querySelectorAll('h3 a[href^="/puzzles/"]').length, url: location.href }));
  console.log("catalogue before:", JSON.stringify(before));
  await page.locator('h3 a[href^="/puzzles/"]').first().click();
  await page.waitForTimeout(2500);
  console.log("on:", page.url());
  await page.goBack();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ q: document.querySelector('input[placeholder^="Search puzzles"]')?.value, cards: document.querySelectorAll('h3 a[href^="/puzzles/"]').length, url: location.href }));
  console.log("catalogue after back:", JSON.stringify(after));

  // Scroll restoration on catalogue (mobile document scroll)
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(800);
  const target = await page.evaluate(() => { const links=[...document.querySelectorAll('h3 a[href^="/puzzles/"]')]; const vis = links.find(a => { const r=a.getBoundingClientRect(); return r.top>60 && r.top<700; }); return vis ? { href: vis.getAttribute('href'), y: window.scrollY } : null; });
  console.log("scroll target:", JSON.stringify(target));
  if (target) {
    await page.locator(`h3 a[href="${target.href}"]`).click();
    await page.waitForTimeout(2500);
    await page.goBack();
    await page.waitForTimeout(3000);
    console.log("scrollY after back:", await page.evaluate(() => window.scrollY));
  }

  // Browse: add Text filter, type, open a card, back
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Add Filter" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("option", { name: "Text" }).click();
  await page.waitForTimeout(600);
  const txt = page.locator('input[type="text"], input[type="search"]').first();
  await txt.fill("Café");
  await page.waitForTimeout(1500);
  const bb = await page.evaluate(() => ({ count: document.body.innerText.match(/\d+ puzzles? found/)?.[0], url: location.href }));
  console.log("browse before:", JSON.stringify(bb));
  await page.screenshot({ path: `${OUT}/m_browse_text.jpg`, type: "jpeg", quality: 70 });
  // open the copy via its stretched link or the image link
  const links = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/copies/"]')].map(a=>a.getAttribute('href')));
  console.log("browse copy links:", links.join(","));
  if (links.length) {
    await page.locator(`main a[href="${links[0]}"]`).first().click();
    await page.waitForTimeout(2500);
    console.log("on:", page.url());
    await page.goBack();
    await page.waitForTimeout(2500);
    const ba = await page.evaluate(() => ({ count: document.body.innerText.match(/\d+ puzzles? found/)?.[0], url: location.href, chips: [...document.querySelectorAll('[data-tour="browse-filters"] button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,6) }));
    console.log("browse after back:", JSON.stringify(ba));
  }
} finally {
  await context.close();
  await browser.close();
}
