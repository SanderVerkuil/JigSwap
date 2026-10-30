import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/JOURNEY";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
const shot = async (name, full=false) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 70, fullPage: full });
try {
  await page.goto(BASE + "/household", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  for (const tab of ["Members", "Sharing", "Settings"]) {
    await page.getByRole("tab", { name: new RegExp(tab) }).click();
    await page.waitForTimeout(1200);
    await shot("t-household-" + tab.toLowerCase());
    console.log("==", tab, await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.innerText.slice(0, 1200)));
  }
  // My puzzles card menu (... menu) on tablet
  await page.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const menuBtn = page.locator('button[aria-haspopup="menu"]').first();
  await menuBtn.click();
  await page.waitForTimeout(800);
  await shot("t-mypuzzles-card-menu");
  console.log("MENU", await page.evaluate(() => document.querySelector('[role="menu"]')?.innerText));
  await page.keyboard.press("Escape");
  // Exchanges Borrowed tab
  await page.goto(BASE + "/trades", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /^Borrowed/ }).or(page.getByRole("tab", { name: /^Borrowed/ })).first().click();
  await page.waitForTimeout(1500);
  await shot("t-trades-borrowed");
  console.log("BORROWED", await page.evaluate(() => document.querySelector("main")?.innerText.slice(0, 800)));
} finally {
  await context.close();
  await browser.close();
}
