import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/VERIFY-SHELL";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
async function ctx(opts, lang = "en") {
  const c = await browser.newContext({ ...opts, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await c.addCookies([{ name: "jigswap-intl", value: lang, url: BASE }]);
  await c.addInitScript(() => { try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    sessionStorage.setItem("jigswap.installTip.shown", "1");
    sessionStorage.setItem("jigswap.installTip.counted", "1"); } catch {} });
  return c;
}
const mobile = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
try {
  // SHELL-1: mobile action rows across routes, EN + NL
  for (const lang of ["en", "nl"]) {
    const c = await ctx(mobile, lang); const p = await c.newPage();
    for (const r of ["/notifications", "/my-puzzles", "/completions", "/circles", "/goals", "/collections", "/people", "/puzzles", "/profile"]) {
      await p.goto(BASE + r, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
      const info = await p.evaluate(() => {
        const row = [...document.querySelectorAll("main div")].find((d) => d.className.includes("md:hidden") && d.className.includes("justify-end"));
        if (!row) return "no row";
        const els = [...row.querySelectorAll("a,button")].map((e) => { const b = e.getBoundingClientRect(); return `${(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,28)}[${Math.round(b.left)}..${Math.round(b.right)}]`; });
        return els.join(" | ");
      });
      console.log("M", lang, r, info);
    }
    await c.close();
  }
  await browser.close(); process.exit(0);
  for (const [w, h, touch] of [[820, 1180, true], [1024, 768, true], [1280, 800, false]]) {
    for (const lang of ["en", "nl"]) {
      const c = await ctx({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch }, lang); const p = await c.newPage();
      for (const r of ["/notifications", "/my-puzzles", "/completions", "/puzzles", "/goals", "/people"]) {
        await p.goto(BASE + r, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
        const info = await p.evaluate(() => {
          const head = document.querySelector("main div.sticky.top-0");
          if (!head) return "no head";
          const card = head.getBoundingClientRect();
          const h1 = head.querySelector("h1"); const hb = h1.getBoundingClientRect();
          const sub = head.querySelector("p"); const sb = sub ? sub.getBoundingClientRect() : null;
          const acts = [...head.querySelectorAll("a,button")].filter(e=>!e.closest("nav")).map((e) => { const b = e.getBoundingClientRect(); return `${(e.innerText||'').trim().slice(0,24)}R=${Math.round(b.right)}`; });
          const actBox = head.querySelector("div.shrink-0")?.getBoundingClientRect();
          return `card=${Math.round(card.left)}..${Math.round(card.right)} h1w=${Math.round(hb.width)}/${h1.scrollWidth} h1R=${Math.round(hb.right)} actL=${actBox?Math.round(actBox.left):'-'} sub=${sb?Math.round(sb.width)+'/'+sub.scrollWidth:'-'} acts=${acts.join(',')}`;
        });
        console.log("T", w, lang, r, info);
      }
      await c.close();
    }
  }
} finally { await browser.close(); }
