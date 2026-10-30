import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MSGV";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const measure = (page) => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const ta = document.querySelector("textarea");
  const h2 = [...document.querySelectorAll("h1,h2")].map(h => `${h.tagName}:${h.innerText.slice(0,20)}:${r(h)}`);
  const opts = [...document.querySelectorAll("button[aria-label]")].filter(b => /option|actions/i.test(b.getAttribute("aria-label"))).map(b => `${b.getAttribute("aria-label")}:${r(b)}:visible=${b.checkVisibility()}`);
  const inset = document.querySelector("[data-slot=sidebar-inset]");
  const log = document.querySelector("ol[aria-label], [role=log]");
  const el = document.activeElement;
  return { vw: innerWidth, inset: r(inset), insetOverflow: inset && getComputedStyle(inset).overflow, textarea: r(ta), taFont: ta && getComputedStyle(ta).fontSize, h2, opts, log: r(log), active: el?.tagName + ":" + (el?.innerText||"").slice(0,20), activeFV: el?.matches?.(":focus-visible"), textDeco: el && getComputedStyle(el).textDecorationLine };
});
async function run(label, vp, cookies, path) {
  const context = await browser.newContext({ ...vp, storageState: "/tmp/jigswap-review/tools/auth.json" });
  if (cookies) await context.addCookies(cookies);
  await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  const page = await context.newPage();
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log(label, path, JSON.stringify(await measure(page)));
    await page.screenshot({ path: `${OUT}/${label}.jpg`, type: "jpeg", quality: 70 });
  } catch (e) { console.log(label, "ERR", e.message); }
  finally { await context.close(); }
}
const DM = "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28";
const tablet = { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true };
await run("tablet-dm", tablet, null, DM);
await run("tablet-dm-collapsed", tablet, [{ name: "sidebar_state", value: "false", url: BASE }], DM);
await run("w900-dm", { viewport: { width: 900, height: 900 } }, null, DM);
await browser.close();
