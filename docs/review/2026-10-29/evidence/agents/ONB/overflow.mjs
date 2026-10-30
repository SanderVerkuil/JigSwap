import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
};
const which = process.argv[2] || "mobile";
const route = process.argv[3] || "/dashboard";
const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    // find the region: main or the scroll region
    const main = document.querySelector("main");
    const info = { vw, mainW: main?.clientWidth, mainSW: main?.scrollWidth, docSW: document.documentElement.scrollWidth };
    // walk parents of main for overflow containers
    const chain = [];
    let el = main;
    while (el) { const s = getComputedStyle(el); chain.push(`${el.tagName}.${(el.className||'').toString().slice(0,80)} ox=${s.overflowX} cw=${el.clientWidth} sw=${el.scrollWidth}`); el = el.parentElement; }
    info.chain = chain;
    for (const e of document.querySelectorAll("main *")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        // skip if inside an overflow-x auto/scroll/hidden ancestor within main
        let p = e.parentElement, clipped = false;
        while (p && p !== main) { const s = getComputedStyle(p); if (["auto","scroll","hidden","clip"].includes(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (clipped) continue;
        out.push(`${e.tagName}.${(e.className||'').toString().slice(0,100)} L=${Math.round(r.left)} R=${Math.round(r.right)} W=${Math.round(r.width)} text="${(e.innerText||'').trim().slice(0,40).replace(/\n/g,' ')}"`);
      }
    }
    info.offenders = out.slice(0, 40);
    return info;
  });
  console.log(JSON.stringify(res, null, 1));
} finally {
  await context.close();
  await browser.close();
}
