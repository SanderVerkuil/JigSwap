import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/DISC";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {}
});
const page = await context.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errs.push("PAGEERR " + String(e).slice(0, 300)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 70 });
try {
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.waitForTimeout(7000);
  await shot("d_puzzles_filters_open");
  const st = await page.evaluate(() => ({ loading: document.body.innerText.includes("Loading..."), aria: [...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==="Filters").map(b=>b.getAttribute('aria-expanded')) }));
  console.log("filters state:", JSON.stringify(st));
  // keyboard focus on cards
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search puzzles by title/).focus();
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 30)}" outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== "none"} td=${s.textDecorationLine}`; }));
    if (i === 4) await shot("d_puzzles_focus_card");
  }
  console.log(order.join("\n"));
  // browse: hover icon
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const btn = page.locator(".mt-auto button").first();
  await btn.hover();
  await page.waitForTimeout(1200);
  await shot("d_browse_hover_icon");
  const tip = await page.evaluate(() => [...document.querySelectorAll('[role=tooltip],[data-slot=tooltip-content]')].map(e=>e.innerText));
  console.log("tooltip:", JSON.stringify(tip));
  // list view on browse
  await page.getByRole("button", { name: "List View" }).click();
  await page.waitForTimeout(800);
  await shot("d_browse_list");
  // catalogue list view
  await page.goto(BASE + "/puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.locator("button:has(svg.lucide-list)").first().click();
  await page.waitForTimeout(800);
  await shot("d_puzzles_list");
  console.log("errors:", errs.slice(0, 10).join("\n"));
} finally {
  await context.close();
  await browser.close();
}
