// READ-ONLY: open the local Edit Profile panel (UI toggle, no save), then rewrite the preview
// span's TEXT in the DOM (client-only, no data write) to see when the form overflows.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/profile", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.waitForTimeout(800);
  const measure = async (txt) => page.evaluate((txt) => {
    const span = [...document.querySelectorAll("span.font-mono")].find((s) => s.textContent.includes("/members/"));
    const orig = span.textContent;
    if (txt) span.textContent = txt;
    const sw = document.querySelector("#profile-visibility").getBoundingClientRect();
    const grid = document.querySelector("#profile-username").closest(".grid").getBoundingClientRect();
    return { text: span.textContent, orig, gridW: Math.round(grid.width), switchRight: Math.round(sw.right), vw: document.documentElement.clientWidth };
  }, txt);
  await page.evaluate(() => { document.querySelector("#profile-username").closest(".grid").style.gridTemplateColumns = "repeat(1, minmax(0, 1fr))"; });
  for (const t of [null, "https://jigswap.site/members/henk-piet", "https://jigswap.site/members/henk-piete", "https://jigswap.site/members/henk-pieter", "https://jigswap.site/members/henk-pieters", "https://jigswap.site/members/henk-pietersz"]) {
    console.log(JSON.stringify(await measure(t)));
  }
  await page.evaluate(() => window.scrollTo(0, 450)); await page.screenshot({ path: '/tmp/jigswap-review/agents/SOCV/m-edit-fixed-gridcols1.jpg', type: 'jpeg', quality: 70 });
} finally { await context.close(); await browser.close(); }
