// READ-ONLY: hydration check on public catalog detail with different browser locales.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
try {
  for (const locale of ["en-US", "nl-NL", "de-DE"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
    const page = await context.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 600)); });
    await page.goto(BASE + "/catalog/m9712xm5gtgnqszgq5xwvh82ph8a9hdz", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const txt = await page.evaluate(() => [...document.querySelectorAll("main p .font-mono, main .font-mono")].map((e) => e.textContent).slice(0, 3).join("|") + " lang=" + document.documentElement.lang + " sub=" + (document.querySelector("main h1")?.nextElementSibling?.textContent || ""));
    console.log(locale, txt, "\n  errors:", errs.map((e) => e.slice(0, 900)).join("\n  ---\n  ") || "none");
    await context.close();
  }
} finally {
  await browser.close();
}
