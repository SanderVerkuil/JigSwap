// READ-ONLY mobile checks: headings, bell/tab names, install tip geometry, palette focus return.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/a11y-verify";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
const info = () => page.evaluate(() => {
  const hs = [...document.querySelectorAll("h1,h2")].filter((h) => h.getClientRects().length && getComputedStyle(h).visibility !== "hidden").map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 28)}`);
  const tip = [...document.querySelectorAll("*")].find((e) => /install/i.test(e.className?.toString?.() || "") || e.getAttribute?.("data-install-tip") !== null && e.getAttribute?.("data-install-tip") !== undefined);
  const nav = document.querySelector('nav[aria-label]:not([aria-label=""])');
  const tabs = [...document.querySelectorAll("nav a[aria-current], nav.sticky a, nav.sticky button")].map((a) => `${a.getAttribute("aria-label")}|text="${a.innerText.trim()}"`);
  const bell = document.querySelector('header a[href="/notifications"]');
  return { hs, tabs, bell: bell && `${bell.getAttribute("aria-label")} text="${bell.innerText.trim()}"`, scrollPaddingBottom: getComputedStyle(document.documentElement).scrollPaddingBottom };
});
try {
  for (const path of ["/dashboard", "/puzzles/m9712xm5gtgnqszgq5xwvh82ph8a9hdz", "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log("==", path, JSON.stringify(await info()));
    // find a fixed/sticky element near the bottom other than the tab bar
    const overlays = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); return (s.position === "sticky" || s.position === "fixed") && e.getClientRects().length; }).map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName}.${(e.className?.toString?.() || "").slice(0, 60)} y=${Math.round(r.top)} h=${Math.round(r.height)} text="${e.innerText.trim().replace(/\s+/g, " ").slice(0, 60)}"`; }));
    console.log("  sticky/fixed:", overlays.join("\n   "));
  }
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: OUT + "/m-dash.jpg", type: "jpeg", quality: 70 });
} finally {
  await context.close();
  await browser.close();
}
