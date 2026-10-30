import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/LIB";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const mk = async (vp) => {
  const context = await browser.newContext({ ...vp, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
      localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true }));
    } catch {}
  });
  return context;
};
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { viewport: { width: 1440, height: 900 } };
let context = await mk(mobile);
let page = await context.newPage();
const shot = async (name, full=false) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 70, fullPage: full });
try {
  // Card overflow menu on mobile
  await page.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Puzzle actions" }).first().click();
  await page.waitForTimeout(700);
  await shot("m-mypuzzles-cardmenu");
  const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(e => { const b=e.getBoundingClientRect(); return `${e.innerText.trim()} ${Math.round(b.height)}px`; }));
  console.log("menu items", JSON.stringify(items));
  await page.keyboard.press("Escape");

  // Create-new form on mobile (no puzzleId)
  await page.goto(BASE + "/my-puzzles/add/new", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("m-addnew-full", true);
  const info = await page.evaluate(() => {
    const out = {};
    out.inputs = [...document.querySelectorAll("input, textarea, [role=combobox]")].map(i => {
      const b = i.getBoundingClientRect();
      const id = i.id; const lab = id ? document.querySelector(`label[for="${id}"]`) : null;
      return `${i.tagName}#${id||''} w=${Math.round(b.width)} fs=${getComputedStyle(i).fontSize} label=${lab ? lab.innerText.trim().slice(0,20) : (i.getAttribute('aria-label')||'NONE')} ph=${(i.getAttribute('placeholder')||'').slice(0,25)}`;
    });
    out.height = document.documentElement.scrollHeight;
    const btn = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Add Puzzle");
    out.addBtn = btn ? Math.round(btn.getBoundingClientRect().top) : null;
    return out;
  });
  console.log("addnew", JSON.stringify(info, null, 1));

  // Quick add with search typed
  await page.goto(BASE + "/my-puzzles/add/quick", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("searchbox").fill("jan");
  await page.waitForTimeout(2500);
  await shot("m-quick-search", true);

  // Add chooser search "jan" on mobile (results density) 
  await page.goto(BASE + "/my-puzzles/add", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByPlaceholder("Search by title, brand or barcode…").fill("8710126");
  await page.waitForTimeout(2500);
  await shot("m-add-barcode");
  await context.close();

  // Desktop: keyboard reachability of "Add photo" on owner copy page
  context = await mk(desktop);
  page = await context.newPage();
  await page.goto(BASE + "/my-puzzles/m572kmqqpcd0c4a106ve41fz318ge4xr", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const order = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const el = document.activeElement;
      return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || el.getAttribute('placeholder') || "").trim().replace(/\s+/g,' ').slice(0, 40)}"`;
    }));
  }
  console.log("TAB ORDER\n" + order.join("\n"));
  const photoInfo = await page.evaluate(() => {
    const inp = document.querySelector('input[type=file]');
    return inp ? { display: getComputedStyle(inp).display, tabIndex: inp.tabIndex, labelTab: inp.closest('label')?.tabIndex } : null;
  });
  console.log("file input", JSON.stringify(photoInfo));
} catch (e) { console.error("ERR", e.message); }
finally {
  await context.close();
  await browser.close();
}
