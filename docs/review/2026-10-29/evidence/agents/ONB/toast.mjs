import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const context = await browser.newContext({ ...phone, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  for (const route of ["/dashboard", "/welcome?step=solves"]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const res = await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").map(e => e.name).find(n => /\/deps\/sonner\.js/.test(n));
      if (!url) return { err: "no sonner url" };
      const mod = await import(url);
      // Same copy the update prompt uses (appUpdate.*), rendered locally only.
      mod.toast("A new version of JigSwap is available", { id: "probe", description: "Reload to get the latest version.", duration: Infinity, action: { label: "Reload", onClick: () => {} }, cancel: { label: "Not now", onClick: () => {} } });
      await new Promise(r => setTimeout(r, 800));
      const t = document.querySelector("[data-sonner-toast]");
      const tab = document.querySelector("nav[aria-label], [data-mobile-tab-bar]") ;
      const r = t?.getBoundingClientRect();
      const fab = [...document.querySelectorAll("button")].find(b => /quick actions/i.test(b.getAttribute("aria-label") || ""));
      const fr = fab?.getBoundingClientRect();
      const cont = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Continue");
      const cr = cont?.getBoundingClientRect();
      const btns = [...(t?.querySelectorAll("button") || [])].map(b => `${b.innerText.trim()} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`); const ff = t ? getComputedStyle(t).fontFamily : null; return { btns, ff, url, toast: r ? [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)] : null, fab: fr ? [Math.round(fr.top), Math.round(fr.bottom)] : null, fabHit: fr ? (document.elementFromPoint(fr.left + fr.width/2, fr.top + fr.height/2)?.closest("[data-sonner-toast]") ? "toast covers FAB" : "FAB reachable") : null, cont: cr ? [Math.round(cr.top), Math.round(cr.bottom)] : null };
    });
    console.log(route, JSON.stringify(res));
    await page.screenshot({ path: `/tmp/jigswap-review/agents/ONB/mobile__toast_${route.replace(/[^a-z]/g, "_")}.jpg`, type: "jpeg", quality: 75 });
  }
} finally {
  await context.close();
  await browser.close();
}
