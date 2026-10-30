import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MSG";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
async function run(name, vp, fn) {
  const context = await browser.newContext({ ...vp, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
  const page = await context.newPage();
  try { await fn(page); } catch (e) { console.log(name, "ERR", e.message); }
  finally { await context.close(); }
}
const measure = (page) => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`; };
  const ta = document.querySelector("textarea");
  const heading = document.querySelector("main h2, main h1:not(:first-of-type)") ;
  const hs = [...document.querySelectorAll("h1,h2")].map(h => `${h.tagName} "${h.innerText.slice(0,30)}" ${r(h)}`);
  const kebab = [...document.querySelectorAll("button")].filter(b => /actions|Thread|Gesprek/i.test(b.getAttribute("aria-label")||"")).map(b => `"${b.getAttribute("aria-label")}" ${r(b)}`);
  const ol = document.querySelector("ol[aria-label]");
  const pane = ol?.parentElement;
  return { vw: innerWidth, textarea: r(ta), taMinW: ta && getComputedStyle(ta).minWidth, hs, kebab, pane: r(pane), docH: document.documentElement.scrollHeight };
});
await run("tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, async (page) => {
  for (const id of ["04e0cd32-b61f-48f9-98e1-c25d9de34c28", "ec1b1833-8cae-47b3-ac3c-783e276b28c9"]) {
    await page.goto(`${BASE}/messages/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log("TABLET", id.slice(0,4), JSON.stringify(await measure(page), null, 1));
  }
  // New menu on tablet
  await page.getByRole("button", { name: /^New$/ }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/tablet-new-menu.jpg`, type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape");
});
for (const w of [768, 1024, 1280]) {
  await run("w" + w, { viewport: { width: w, height: 900 } }, async (page) => {
    await page.goto(`${BASE}/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log("W", w, JSON.stringify(await measure(page)));
    if (w === 1024) await page.screenshot({ path: `${OUT}/w1024-thread.jpg`, type: "jpeg", quality: 70 });
  });
}
await browser.close();
