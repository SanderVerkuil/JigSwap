import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/JOURNEY";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
const shot = async (name, full=false) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 70, fullPage: full });
try {
  for (const step of ["puzzles", "people", "household", "profile"]) {
    await page.goto(BASE + "/welcome?step=" + step, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await shot("m-welcome-" + step);
    console.log(step, await page.evaluate(() => document.querySelector("main")?.innerText.slice(0, 900)));
  }
  // puzzles step with a search typed
  await page.goto(BASE + "/welcome?step=puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const search = page.getByRole("searchbox").or(page.locator('input[type="search"], input[placeholder]')).first();
  await search.fill("jan");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(()=>{});
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(500);
  await shot("m-welcome-puzzles-search");
  await shot("m-welcome-puzzles-search-full", true);
  console.log("SEARCH", await page.evaluate(() => document.querySelector("main")?.innerText.slice(0, 1500)));
  // quick sheet
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator('nav button[aria-label]').first().click();
  await page.waitForTimeout(1200);
  await shot("m-quick-sheet");
  console.log("SHEET", await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText));
} finally {
  await context.close();
  await browser.close();
}
