// READ-ONLY interaction checks for the SHELL review.
import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SHELL";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

async function ctx(kind, extraCookies = []) {
  const opts =
    kind === "desktop"
      ? { viewport: { width: 1440, height: 900 } }
      : kind === "tablet"
        ? { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const context = await browser.newContext({
    ...opts,
    storageState: "/tmp/jigswap-review/tools/auth.json",
  });
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
      sessionStorage.setItem("jigswap.installTip.shown", "1");
      sessionStorage.setItem("jigswap.installTip.counted", "1");
    } catch {}
  });
  if (extraCookies.length) await context.addCookies(extraCookies);
  return context;
}

const shot = (page, name) =>
  page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 75 });

const which = process.argv[2] || "all";

// 1. Desktop: command palette via Ctrl+K, typed search, keyboard order
if (which === "all" || which === "desktop") {
  const context = await ctx("desktop");
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const order = [];
    await page.mouse.click(700, 500).catch(() => {});
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return `${el.tagName} "${(el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40)}" ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== "none"}`;
        }),
      );
    }
    console.log("DESKTOP TAB ORDER\n" + order.join("\n"));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(800);
    await shot(page, "d_palette_empty");
    const paletteInfo = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return "no dialog";
      const items = [...d.querySelectorAll('[cmdk-item]')].map((i) => i.innerText.trim());
      const groups = [...d.querySelectorAll('[cmdk-group-heading]')].map((i) => i.innerText.trim());
      return JSON.stringify({ groups, items, h: d.getBoundingClientRect().height });
    });
    console.log("PALETTE", paletteInfo);
    await page.keyboard.type("kat", { delay: 60 });
    await page.waitForTimeout(1500);
    await shot(page, "d_palette_kat");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("sander", { delay: 60 });
    await page.waitForTimeout(1500);
    await shot(page, "d_palette_sander");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("messages", { delay: 60 });
    await page.waitForTimeout(1500);
    await shot(page, "d_palette_messages");
    console.log(
      "PALETTE messages",
      await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d ? d.innerText.slice(0, 600) : "none";
      }),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    // bell popover
    await page.getByRole("button", { name: "Notifications" }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, "d_bell_popover");
    await page.keyboard.press("Escape");
    // theme menu
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.waitForTimeout(500);
    await shot(page, "d_theme_menu");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.waitForTimeout(500);
    await shot(page, "d_lang_menu");
    await page.keyboard.press("Escape");
    // sidebar group label hover
    await page.hover('a[href="/library"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/d_grouplabel_hover.jpg`, type: "jpeg", quality: 75, clip: { x: 0, y: 60, width: 260, height: 600 } });
  } finally {
    await context.close();
  }
}

// 2. Tablet: collapsed sidebar via cookie (no click), plus NL page heads
if (which === "all" || which === "tablet") {
  for (const [label, cookies] of [
    ["t_collapsed", [{ name: "sidebar_state", value: "false", url: BASE }]],
    ["t_nl", [{ name: "jigswap-intl", value: "nl", url: BASE }]],
  ]) {
    const context = await ctx("tablet", cookies);
    const page = await context.newPage();
    try {
      for (const route of ["/notifications", "/my-puzzles", "/messages"]) {
        await page.goto(BASE + route, { waitUntil: "networkidle" });
        await page.waitForTimeout(2500);
        await shot(page, `${label}_${route.replace(/\//g, "")}`);
        const info = await page.evaluate(() => {
          const sb = document.querySelector('[data-slot="sidebar"]');
          const head = document.querySelector("main h1");
          return JSON.stringify({ sidebarState: sb?.getAttribute("data-state"), h1: head?.innerText });
        });
        console.log(label, route, info);
      }
    } finally {
      await context.close();
    }
  }
}

// 3. Mobile: palette, avatar menu, quick sheet
if (which === "all" || which === "mobile") {
  const context = await ctx("mobile");
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Search" }).first().click();
    await page.waitForTimeout(900);
    await shot(page, "m_palette");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Quick actions/i }).click();
    await page.waitForTimeout(900);
    await shot(page, "m_quicksheet");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page.locator(".cl-userButtonTrigger").first().click();
    await page.waitForTimeout(1500);
    await shot(page, "m_usermenu");
    console.log(
      "USERMENU",
      await page.evaluate(() => {
        const c = document.querySelector(".cl-userButtonPopoverCard");
        return c ? c.innerText.replace(/\n+/g, " | ") : "none";
      }),
    );
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
}

await browser.close();
