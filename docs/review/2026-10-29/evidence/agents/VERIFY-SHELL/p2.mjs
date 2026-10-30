import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/VERIFY-SHELL";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const p = await c.newPage();
try {
  await p.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  const lm = await p.evaluate(() => [...document.querySelectorAll("header,main,nav,aside,[role=navigation],[role=banner],[role=main],[role=complementary]")].filter(e=>e.getClientRects().length).map(e => `${e.tagName}[${e.getAttribute("aria-label")||""}]`).join(", "));
  console.log("landmarks:", lm);
  let firstMain = -1; const stops = [];
  for (let i = 1; i <= 40; i++) {
    await p.keyboard.press("Tab");
    const r = await p.evaluate(() => { const el = document.activeElement; const inHead = !!el.closest("main div.sticky.top-0"); const inMain = !!el.closest("main"); return { t: `${el.tagName} "${(el.getAttribute("aria-label")||el.innerText||"").trim().slice(0,24)}"`, inMain, inHead }; });
    stops.push(`${i}:${r.t}${r.inMain ? (r.inHead ? "[head]" : "[MAIN]") : ""}`);
    if (r.inMain && !r.inHead && firstMain < 0) { firstMain = i; break; }
  }
  console.log(stops.join("\n")); console.log("first in-content stop:", firstMain);
  // Bell accessible name
  const bell = await p.evaluate(() => { const b = document.querySelector('button[data-slot="popover-trigger"]'); return b ? `${b.getAttribute("aria-label")} | text=${b.innerText}` : "none"; });
  console.log("bell:", bell);
  // Palette
  await p.keyboard.press("Control+k"); await p.waitForTimeout(600);
  for (const term of ["g", "go", "gol", "add", "mess", "kat"]) {
    await p.fill("[cmdk-input]", term); await p.waitForTimeout(1500);
    const items = await p.evaluate(() => [...document.querySelectorAll("[cmdk-group-heading]")].map(h => h.innerText).join("/") + " :: " + [...document.querySelectorAll("[cmdk-item]")].map(i => i.innerText.trim()).slice(0, 8).join(" | ") + " :: " + (document.querySelector("[cmdk-list]")?.innerText.slice(0,80).replace(/\n/g," ")));
    console.log(`palette "${term}":`, items);
  }
  await p.screenshot({ path: OUT + "/d_palette_gol.jpg", type: "jpeg", quality: 70 });
  await p.keyboard.press("Escape");
  // theme menu aria-checked
  await p.getByRole("button", { name: /theme|thema/i }).first().click(); await p.waitForTimeout(400);
  console.log("theme items:", await p.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menuitemradio]')].map(e=>`${e.getAttribute('role')}:${e.innerText}:${e.getAttribute('aria-checked')}`).join(", ")));
  await p.keyboard.press("Escape");
} finally { await c.close(); await browser.close(); }
