// READ-ONLY desktop checks: tab order, landmarks, bell name, palette focus return, bell popover, SPA nav focus.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/a11y-verify";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {}
});
const page = await context.newPage();
const desc = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "BODY";
  const name = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const inMain = !!el.closest("main");
  return `${el.tagName.toLowerCase()} "${name}" inMain=${inMain} inDialog=${!!el.closest('[role=dialog]')}`;
});
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const lm = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("header,nav,main,aside,footer,section,[role]").forEach((e) => {
      const r = e.getAttribute("role");
      if (r && !["banner","navigation","main","complementary","contentinfo","region","search"].includes(r)) return;
      const s = getComputedStyle(e); if (s.display === "none") return;
      if (e.tagName === "SECTION" && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")) return;
      out.push(`${e.tagName.toLowerCase()}[${r || ""}] ${e.getAttribute("aria-label") || ""} visible=${e.getClientRects().length > 0}`);
    });
    const main = document.querySelector("main");
    return { out, mainId: main && main.id, mainTabindex: main && main.getAttribute("tabindex"), sidebarInNav: !!document.querySelector('[data-sidebar=sidebar]')?.closest('nav,[role=navigation]') };
  });
  console.log("LANDMARKS", JSON.stringify(lm));
  let first = -1;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const d = await desc();
    if (i < 3 || (first < 0 && d.includes("inMain=true"))) console.log(i + 1, d);
    if (first < 0 && d.includes("inMain=true")) first = i + 1;
  }
  console.log("FIRST IN MAIN at Tab", first);

  // Bell accessible name
  const bell = page.locator('button[data-slot="popover-trigger"][aria-label]').first();
  console.log("BELL snapshot:", await bell.ariaSnapshot().catch((e) => "err " + e.message));
  // Open bell popover via keyboard
  await bell.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  console.log("BELL OPEN focus:", await desc());
  console.log("BELL dialog:", await page.evaluate(() => {
    const d = document.querySelector('[data-slot=popover-content]');
    return d ? `role=${d.getAttribute("role")} labelledby=${d.getAttribute("aria-labelledby")} label=${d.getAttribute("aria-label")}` : "none";
  }));
  await page.screenshot({ path: OUT + "/bell-open.jpg", type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  console.log("BELL after Esc focus:", await desc());

  // Palette via the pill (focus + Enter), then Escape
  const pill = page.locator("button", { hasText: /Search puzzles/ }).first();
  await pill.focus();
  console.log("PILL focused:", await desc());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  console.log("PALETTE focus:", await desc());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  console.log("PALETTE after Esc focus:", await desc());
  // Palette via Ctrl+K from a focused link in main
  await page.locator("main a").first().focus();
  console.log("Focused before ctrl+k:", await desc());
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  console.log("CTRL+K after Esc focus:", await desc());

  // headings
  console.log("HEADINGS:", await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3")].map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 30)}:vis=${h.getClientRects().length > 0}`).join(" | ")));

  // SPA nav: focus sidebar My Puzzles link and press Enter
  const link = page.locator('[data-sidebar=sidebar] a[href="/my-puzzles"]').first();
  await link.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/my-puzzles/);
  await page.waitForTimeout(1500);
  console.log("AFTER NAV url=", page.url(), "title=", await page.title(), "focus:", await desc());
  console.log("live regions:", await page.evaluate(() => [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map((e) => `${e.tagName}[${e.getAttribute('aria-live') || e.getAttribute('role')}] "${e.textContent.trim().slice(0, 40)}"`).join(" | ")));
} finally {
  await context.close();
  await browser.close();
}
