import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
for (const [vp, route] of [[390, "/dashboard"], [820, "/dashboard"]]) {
  const context = await browser.newContext({
    viewport: { width: vp, height: vp === 390 ? 844 : 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    storageState: "/tmp/jigswap-review/tools/auth.json",
  });
  await context.addInitScript(() => { try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    sessionStorage.setItem("jigswap.installTip.shown", "1");
    sessionStorage.setItem("jigswap.installTip.counted", "1"); } catch {} });
  const page = await context.newPage();
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    console.log(vp, route, page.url());
    const info = await page.evaluate(() => {
      const region = document.querySelector('[data-scroll-restoration-id]');
      const rr = region.getBoundingClientRect();
      const out = [];
      const scrollerAncestor = (el) => { let p = el.parentElement; while (p && p !== region) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; p = p.parentElement; } return false; };
      region.querySelectorAll("*").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > rr.right + 1 && !scrollerAncestor(el)) { const chain=[]; let p=el; for (let i=0;i<6&&p;i++){ chain.push((p.getAttribute("data-slot")||p.getAttribute("data-tour")||p.tagName)+":"+String(p.className||"").slice(0,60)); p=p.parentElement; } out.push("R="+Math.round(r.right)+" W="+Math.round(r.width)+" :: "+chain.join(" < ")); }
      });
      return `region ${Math.round(rr.width)} sw=${region.scrollWidth}\n` + out.slice(0, 8).join("\n");
    });
    console.log(info);
  } finally { await context.close(); }
}
await browser.close();
