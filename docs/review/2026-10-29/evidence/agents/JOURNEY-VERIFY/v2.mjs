import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/JOURNEY-VERIFY";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
function authWith(locale) {
  const auth = JSON.parse(readFileSync("/tmp/jigswap-review/tools/auth.json", "utf8"));
  auth.cookies = auth.cookies.filter((c) => c.name !== "jigswap-intl");
  auth.cookies.push({ name: "jigswap-intl", value: locale, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" });
  return auth;
}
async function ctx(opts) {
  const c = await browser.newContext(opts);
  await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); sessionStorage.setItem("jigswap.installTip.shown", "1"); } catch {} });
  return c;
}
try {
  const c = await ctx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: authWith("nl"), locale: "nl-NL" });
  const p = await c.newPage();
  await p.goto(BASE + "/my-puzzles/add", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  console.log(await p.evaluate(() => {
    const row = [...document.querySelectorAll("div.justify-end")].find((d) => d.className.includes("md:hidden") && d.className.includes("gap-2"));
    return [...row.children].map((k) => `${k.tagName}.${k.className.slice(0,60)} left=${Math.round(k.getBoundingClientRect().left)} w=${Math.round(k.getBoundingClientRect().width)} "${k.innerText.trim()}" aria=${k.getAttribute("aria-label")}`).join("\n");
  }));
  await p.screenshot({ path: `${OUT}/m-nl-my-puzzles-add.jpg`, type: "jpeg", quality: 70, clip: { x: 0, y: 0, width: 390, height: 200 } });
  await c.close();

  // Tablet: collapse sidebar via its trigger (UI-only, no data) and re-measure the composer
  const t = await ctx({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, storageState: authWith("en") });
  const tp = await t.newPage();
  await tp.goto(BASE + "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28", { waitUntil: "networkidle" });
  await tp.waitForTimeout(2500);
  const trig = tp.locator('[data-sidebar="trigger"], [data-slot="sidebar-trigger"]').first();
  console.log("trigger count", await trig.count(), await trig.getAttribute("aria-label").catch(() => null));
  await trig.click();
  await tp.waitForTimeout(800);
  console.log("after collapse", JSON.stringify(await tp.evaluate(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })));
  await tp.screenshot({ path: `${OUT}/t-thread-sidebar-collapsed.jpg`, type: "jpeg", quality: 70 });
  // reload: does collapse persist?
  await tp.reload({ waitUntil: "networkidle" });
  await tp.waitForTimeout(2500);
  console.log("after reload", JSON.stringify(await tp.evaluate(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return { w: Math.round(r.width), cookie: document.cookie.includes("sidebar_state") }; })));
  // Landscape tablet 1180x820
  await tp.setViewportSize({ width: 1180, height: 820 });
  await tp.waitForTimeout(1000);
  console.log("landscape", JSON.stringify(await tp.evaluate(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return { w: Math.round(r.width) }; })));
  await t.close();
} finally {
  await browser.close();
}
