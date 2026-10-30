import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/LIB";
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
const shot = async (name, full=false) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 70, fullPage: full });
try {
  // 1. Mobile copy detail (owner) - above the fold and positions
  await page.goto(BASE + "/my-puzzles/m572kmqqpcd0c4a106ve41fz318ge4xr", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("m-copy-owner-01");
  const pos = await page.evaluate(() => {
    const r = {};
    const q = (sel, txt) => [...document.querySelectorAll(sel)].find(e => (e.innerText||"").includes(txt));
    for (const [k, txt] of [["swapBtn","Offered for Swap"],["lendBtn","Offer to Lend"],["logBtn","Log a Completion"],["startBtn","Start puzzle"]]) {
      const el = q("button", txt); if (el) { const b = el.getBoundingClientRect(); r[k] = [Math.round(b.top), Math.round(b.height), Math.round(b.width)]; }
    }
    const h1s = [...document.querySelectorAll("h1")].map(h => { const b = h.getBoundingClientRect(); return [h.innerText.slice(0,30), Math.round(b.top), getComputedStyle(h).display, h.closest('[class*="sr-only"]') ? 'sr' : '']; });
    r.h1s = h1s;
    r.vh = innerHeight;
    return r;
  });
  console.log("copy-owner positions", JSON.stringify(pos));
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(500);
  await shot("m-copy-owner-02");

  // 2. Mobile public copy (non-owner): where is Request swap?
  await page.goto(BASE + "/copies/m578n0zx5r5mrsgfb9mjz6czyx8gev0m", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("m-copy-public-01");
  const pos2 = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find(e => (e.innerText||"").includes("Request swap"));
    const b = el?.getBoundingClientRect();
    return { request: b ? [Math.round(b.top), Math.round(b.height)] : null, vh: innerHeight };
  });
  console.log("copy-public positions", JSON.stringify(pos2));

  // 3. My puzzles: open owner filter select & card menu
  await page.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("m-mypuzzles-01");
  await page.getByRole("button", { name: "List view" }).click();
  await page.waitForTimeout(800);
  await shot("m-mypuzzles-list");
  await page.getByRole("combobox", { name: "Whose puzzles" }).click();
  await page.waitForTimeout(600);
  await shot("m-mypuzzles-ownerselect");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const menuBtn = page.getByRole("button", { name: /actions|more|menu/i }).first();
  console.log("menu btn count", await page.getByRole("button", { name: /actions|more|menu/i }).count());
  await menuBtn.click();
  await page.waitForTimeout(700);
  await shot("m-mypuzzles-cardmenu");
  const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(e => { const b=e.getBoundingClientRect(); return `${e.innerText.trim()} ${Math.round(b.height)}px`; }));
  console.log("menu items", JSON.stringify(items));
  await page.keyboard.press("Escape");
} catch (e) { console.error("ERR", e.message); }
finally {
  await context.close();
  await browser.close();
}
