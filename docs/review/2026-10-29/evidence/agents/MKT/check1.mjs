// READ-ONLY checks for MKT area. No clicks on writing controls.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/MKT";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" };
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();
try {
  // 1. SSR HTML of catalog detail: what number format does the server send?
  const res = await page.request.get(BASE + "/catalog/m9712xm5gtgnqszgq5xwvh82ph8a9hdz", { headers: { "accept-language": "en-US,en;q=0.9" } });
  const html = await res.text();
  const m = html.match(/font-mono">([^<]*)<\/span>[^<]*pieces/);
  console.log("SSR pieceCount text:", m && m[1], "| html lang:", (html.match(/<html lang="(\w+)"/) || [])[1]);

  // 2. Home with cookie banner: accessible names of banner buttons (no clicking)
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const bannerBtns = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button")) {
      const t = b.textContent.trim();
      if (/decline|accept/i.test(t)) {
        const r = b.getBoundingClientRect();
        out.push({ textContent: t, h: Math.round(r.height), w: Math.round(r.width) });
      }
    }
    return out;
  });
  console.log("cookie buttons:", JSON.stringify(bannerBtns));
  const snap = await page.accessibility?.snapshot?.().catch(() => null);
  if (snap) {
    const names = [];
    const walk = (n) => { if (n.role === "button" && /decline|accept/i.test(n.name || "")) names.push(n.name); (n.children || []).forEach(walk); };
    walk(snap);
    console.log("a11y names:", JSON.stringify(names));
  }
  // Banner link to policy?
  const bannerLink = await page.evaluate(() => {
    const d = [...document.querySelectorAll("[data-slot=card-description]")].find((e) => /cookie/i.test(e.textContent));
    return d ? { hasLink: !!d.closest(".fixed")?.querySelector("a"), text: d.textContent.slice(0, 80) } : null;
  });
  console.log("banner link:", JSON.stringify(bannerLink));

  // 3. Mobile marketing menu: open, inspect aria-expanded, Escape behaviour
  const menuBtn = page.getByRole("button", { name: "Open menu" });
  console.log("menu aria-expanded before:", await menuBtn.getAttribute("aria-expanded"));
  await menuBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "/mobile-menu-open.jpg", type: "jpeg", quality: 75 });
  const closeBtn = page.getByRole("button", { name: "Close menu" });
  console.log("menu aria-expanded after:", await closeBtn.getAttribute("aria-expanded"), "focus:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("menu still open after Escape:", await closeBtn.isVisible().catch(() => false));
} finally {
  await ctx.close();
  await browser.close();
}
