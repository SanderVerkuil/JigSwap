import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/JOURNEY-VERIFY";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
function authWith(locale, extra = []) {
  const auth = JSON.parse(readFileSync("/tmp/jigswap-review/tools/auth.json", "utf8"));
  auth.cookies = auth.cookies.filter((c) => c.name !== "jigswap-intl" && c.name !== "sidebar_state");
  auth.cookies.push({ name: "jigswap-intl", value: locale, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" });
  for (const c of extra) auth.cookies.push({ domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax", ...c });
  return auth;
}
async function ctx(opts) {
  const c = await browser.newContext(opts);
  await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); sessionStorage.setItem("jigswap.installTip.shown", "1"); } catch {} });
  return c;
}
const tablet = { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true };
const thread = "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28";
const circleThread = "/messages/ec1b1833-8cae-47b3-ac3c-783e276b28c9";
try {
  for (const [label, extra] of [["sidebar-default", []], ["sidebar-collapsed", [{ name: "sidebar_state", value: "false" }]]]) {
    const c = await ctx({ ...tablet, storageState: authWith("en", extra) });
    const p = await c.newPage();
    for (const url of [thread, circleThread]) {
      await p.goto(BASE + url, { waitUntil: "networkidle" });
      await p.waitForTimeout(2500);
      const m = await p.evaluate(() => {
        const ta = document.querySelector("textarea");
        const r = ta?.getBoundingClientRect();
        const pane = ta?.closest(".flex-1.flex-col");
        const side = document.querySelector('[data-slot="sidebar"]') || document.querySelector('[data-sidebar="sidebar"]');
        return { textareaW: r && Math.round(r.width), textareaH: r && Math.round(r.height), fontSize: ta && getComputedStyle(ta).fontSize, sidebarState: document.querySelector('[data-state][data-collapsible]')?.getAttribute('data-state') };
      });
      console.log(label, url, JSON.stringify(m));
      if (label === "sidebar-collapsed" && url === thread) await p.screenshot({ path: `${OUT}/t-thread-collapsed.jpg`, type: "jpeg", quality: 70 });
    }
    await c.close();
  }
  // Mobile page-actions overflow, EN + NL
  const routes = ["/notifications", "/my-puzzles", "/completions", "/goals", "/circles", "/people", "/profile", "/collections", "/trades", "/my-puzzles/add", "/puzzles", "/messages"];
  for (const loc of ["en", "nl"]) {
    const c = await ctx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: authWith(loc), locale: loc === "nl" ? "nl-NL" : "en-GB" });
    const p = await c.newPage();
    for (const r of routes) {
      await p.goto(BASE + r, { waitUntil: "networkidle" });
      await p.waitForTimeout(1800);
      const m = await p.evaluate(() => {
        const row = [...document.querySelectorAll("div.justify-end")].find((d) => d.className.includes("md:hidden") && d.className.includes("gap-2"));
        if (!row) return null;
        const kids = [...row.children].filter((k) => getComputedStyle(k).display !== "none");
        return { rowW: Math.round(row.getBoundingClientRect().width), minLeft: Math.round(Math.min(...kids.map((k) => k.getBoundingClientRect().left))), labels: kids.map((k) => k.innerText.trim()).join(" | ") };
      });
      console.log("ACTIONS", loc, r, JSON.stringify(m));
    }
    await c.close();
  }
  // NL sign-up footer link target (signed out)
  const s = await ctx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "nl-NL", storageState: { cookies: [{ name: "jigswap-intl", value: "nl", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } });
  const sp = await s.newPage();
  await sp.goto(BASE + "/sign-up", { waitUntil: "networkidle" });
  await sp.waitForTimeout(3000);
  console.log("NL signup links", JSON.stringify(await sp.evaluate(() => [...document.querySelectorAll("a")].map((a) => [a.innerText.trim(), a.getAttribute("href")]))));
  await s.close();
} finally {
  await browser.close();
}
