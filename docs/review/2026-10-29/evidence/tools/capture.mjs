// Captures every route across viewport/theme/locale variants with screenshots, axe-core
// results and layout metrics. Read-only: it only navigates, never clicks or submits.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/shots";
const TILES = "/tmp/jigswap-review/tiles";

const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 15; SM-X720) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  tablet: {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID_TABLET,
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID_PHONE,
  },
};

const VARIANTS = [
  { name: "desktop-light", device: "desktop", scheme: "light", locale: "en", axe: true },
  { name: "tablet-light", device: "tablet", scheme: "light", locale: "en", axe: true },
  { name: "mobile-light", device: "mobile", scheme: "light", locale: "en", axe: true },
  { name: "desktop-dark", device: "desktop", scheme: "dark", locale: "en", axe: true },
  { name: "mobile-dark", device: "mobile", scheme: "dark", locale: "en", axe: true },
  { name: "mobile-nl", device: "mobile", scheme: "light", locale: "nl", axe: false },
];

const PUBLIC = [
  "/",
  "/about",
  "/features",
  "/how-it-works",
  "/privacy",
  "/terms",
  "/contact",
  "/catalog",
  "/catalog/m9712xm5gtgnqszgq5xwvh82ph8a9hdz",
  "/docs",
  "DOCS_PAGE",
  "/members/sander",
  "/sign-in",
  "/sign-up",
  "/this-page-does-not-exist",
];

const DASHBOARD = [
  "/dashboard",
  "/welcome",
  "/my-puzzles",
  "/my-puzzles/m572kmqqpcd0c4a106ve41fz318ge4xr",
  "/my-puzzles/add",
  "/my-puzzles/add/new?puzzleId=m9712xm5gtgnqszgq5xwvh82ph8a9hdz",
  "/my-puzzles/add/quick",
  "/my-puzzles/suggestions",
  "/library",
  "/copies/m578n0zx5r5mrsgfb9mjz6czyx8gev0m",
  "/puzzles",
  "/puzzles/m9712xm5gtgnqszgq5xwvh82ph8a9hdz",
  "/puzzles/m9712xm5gtgnqszgq5xwvh82ph8a9hdz/suggest-edit",
  "/puzzles/add",
  "/browse",
  "/circles",
  "/circles/3e51e703-87d4-435a-91d7-29327390e7b1",
  "/messages",
  "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28",
  "/messages/ec1b1833-8cae-47b3-ac3c-783e276b28c9",
  "/messages/new",
  "/collections",
  "/people",
  "/community",
  "/household",
  "/trades",
  "/borrowed",
  "/completions",
  "/completions/new",
  "/goals",
  "/insights",
  "/notifications",
  "/notifications/preferences",
  "/profile",
  "/whats-new",
  "/members/sander",
  "/members/kd7945krncsg0nr1chmgbgnw2x7m0dca",
];

const slug = (p) =>
  p.replace(/^\//, "").replace(/[/?=&#]+/g, "_").replace(/_+$/, "") || "home";

// Runs in the page: layout and touch-target metrics.
function metrics() {
  const vw = window.innerWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const desc = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
    const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${label ? ` [aria="${label.slice(0, 40)}"]` : ""}${text ? ` "${text}"` : ""}`;
  };
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - vw;
  const overflowOffenders = [];
  if (overflowX > 1) {
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && r.width < doc.scrollWidth + 1) {
        overflowOffenders.push(`${desc(el)} right=${Math.round(r.right)}`);
        if (overflowOffenders.length >= 8) break;
      }
    }
  }
  const interactive = [
    ...document.querySelectorAll(
      "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=combobox]",
    ),
  ].filter(visible);
  const under24 = [];
  const under44 = [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) under24.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    else if (r.width < 44 || r.height < 44) under44.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const unnamed = interactive
    .filter((el) => ["A", "BUTTON"].includes(el.tagName) || el.getAttribute("role") === "button")
    .filter((el) => {
      const name =
        (el.innerText || "").trim() ||
        el.getAttribute("aria-label") ||
        el.getAttribute("aria-labelledby") ||
        el.getAttribute("title") ||
        [...el.querySelectorAll("img[alt],svg title")].map((n) => n.getAttribute?.("alt") || n.textContent).join("");
      return !name;
    })
    .map(desc);
  const truncated = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || el.children.length > 0) continue;
    const s = getComputedStyle(el);
    if ((s.overflow === "hidden" || s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") && el.scrollWidth > el.clientWidth + 1) {
      truncated.push(desc(el));
      if (truncated.length >= 15) break;
    }
  }
  const smallText = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 0 || !visible(el) || !(el.innerText || "").trim()) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) {
      smallText.push(`${desc(el)} ${fs}px`);
      if (smallText.length >= 10) break;
    }
  }
  const zoomingInputs = [...document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select")]
    .filter(visible)
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => `${desc(el)} ${getComputedStyle(el).fontSize}`)
    .slice(0, 10);
  const region = document.querySelector('[data-scroll-restoration-id="app-content"]');
  return {
    regionScrollHeight: region ? region.scrollHeight : null,
    regionOverflowX: region ? region.scrollWidth - region.clientWidth : null,
    title: document.title,
    lang: doc.lang,
    h1: [...document.querySelectorAll("h1")].map((h) => h.innerText.trim().slice(0, 80)),
    headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 25).map((h) => `${h.tagName} ${h.innerText.trim().slice(0, 50)}`),
    pageHeight: doc.scrollHeight,
    overflowX,
    overflowOffenders,
    interactiveCount: interactive.length,
    tapUnder24: under24.length,
    tapUnder24Examples: under24.slice(0, 12),
    tap24to44: under44.length,
    tap24to44Examples: under44.slice(0, 8),
    unnamedControls: unnamed.slice(0, 12),
    truncatedText: truncated,
    smallText,
    zoomingInputs,
    imgsMissingAlt: [...document.querySelectorAll("img:not([alt])")].length,
    dialogsOpen: [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].filter(visible).map(desc).slice(0, 4),
  };
}

async function runVariant(browser, v, docsPage) {
  const dir = `${OUT}/${v.name}`;
  mkdirSync(dir, { recursive: true });
  const results = [];
  for (const authed of [false, true]) {
    const auth = JSON.parse(readFileSync("/tmp/jigswap-review/tools/auth.json", "utf8"));
    auth.cookies = auth.cookies.filter((c) => c.name !== "jigswap-intl");
    auth.cookies.push({
      name: "jigswap-intl",
      value: v.locale,
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
    const storageState = authed
      ? auth
      : { cookies: auth.cookies.filter((c) => c.name === "jigswap-intl" || c.name === "cookieConsent"), origins: [] };
    const context = await browser.newContext({
      ...DEVICES[v.device],
      colorScheme: v.scheme,
      locale: v.locale === "nl" ? "nl-NL" : "en-GB",
      extraHTTPHeaders: { "accept-language": v.locale === "nl" ? "nl-NL,nl;q=0.9" : "en-GB,en;q=0.9" },
      storageState,
    });
    // The what's-new highlight is "once per session"; every captured page is a fresh tab, so mark
    // it shown up front instead of dismissing it (dismissal would write markSeen to the account).
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
      } catch {}
    });
    const routes = (authed ? DASHBOARD : PUBLIC)
      .map((p) => (p === "DOCS_PAGE" ? docsPage : p))
      .filter((p) => !process.env.ROUTE_FILTER || process.env.ROUTE_FILTER.split(",").includes(p));
    for (const route of routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      const httpErrors = [];
      page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
      page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message.slice(0, 300)));
      page.on("response", (r) => r.status() >= 400 && httpErrors.push(`${r.status()} ${r.url().slice(0, 160)}`));
      const name = `${authed ? "app" : "pub"}__${slug(route)}`;
      const started = performance.now();
      const entry = { variant: v.name, route, authed, name };
      try {
        await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(2500);
        entry.loadMs = Math.round(performance.now() - started);
        entry.finalUrl = page.url().replace(BASE, "");
        entry.metrics = await page.evaluate(metrics);
        if (v.axe) {
          await page.addScriptTag({ path: AXE });
          const axe = await page.evaluate(async (darkOnly) => {
            const opts = darkOnly
              ? { runOnly: { type: "rule", values: ["color-contrast"] } }
              : { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } };
            const r = await window.axe.run(document, opts);
            return r.violations.map((x) => ({
              id: x.id,
              impact: x.impact,
              help: x.help,
              count: x.nodes.length,
              nodes: x.nodes.slice(0, 4).map((n) => ({
                target: n.target.join(" "),
                html: n.html.slice(0, 160),
                summary: (n.failureSummary || "").slice(0, 240),
              })),
            }));
          }, v.scheme === "dark");
          entry.axe = axe;
        }
        // Stepwise viewport captures of whichever element scrolls (the app shell scrolls an inner
        // region from md up; phones and marketing pages scroll the document).
        const tilesDir = `${TILES}/${v.name}`;
        mkdirSync(tilesDir, { recursive: true });
        const tiles = [];
        let region = false;
        for (let i = 0; i < 8; i++) {
          const info = await page.evaluate(({ i }) => {
            const r = document.querySelector('[data-scroll-restoration-id="app-content"]');
            const useRegion = !!r && r.scrollHeight > r.clientHeight + 5 && getComputedStyle(r).overflowY !== "visible";
            const el = useRegion ? r : document.scrollingElement;
            const client = useRegion ? r.clientHeight : window.innerHeight;
            const step = Math.max(200, Math.round(client * 0.9));
            el.scrollTo(0, i * step);
            return { useRegion, scrollHeight: el.scrollHeight, client, top: el.scrollTop, step };
          }, { i });
          region = info.useRegion;
          if (i > 0 && info.top < (i - 1) * info.step + 5) break;
          await page.waitForTimeout(i === 0 ? 150 : 600);
          const path = `${tilesDir}/${name}__${String(i + 1).padStart(2, "0")}.jpg`;
          await page.screenshot({ path, type: "jpeg", quality: 80 });
          tiles.push(path);
          entry.scroll = info;
          if (info.top + info.client >= info.scrollHeight - 2) break;
        }
        entry.tiles = tiles;
        entry.scrollsInnerRegion = region;
      } catch (e) {
        entry.error = e.message.split("\n")[0];
      }
      entry.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
      entry.httpErrors = [...new Set(httpErrors)].slice(0, 10);
      writeFileSync(`${dir}/${name}.json`, JSON.stringify(entry, null, 2));
      results.push(entry);
      console.log(v.name, route, entry.error ?? `${entry.loadMs}ms`);
      await page.close();
    }
    await context.close();
  }
  return results;
}

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
// Pick a real docs article for the docs-page route.
const probe = await browser.newContext();
const probePage = await probe.newPage();
await probePage.goto(BASE + "/docs", { waitUntil: "networkidle" });
const docsLinks = await probePage.locator("a[href^='/docs/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
const docsPage = docsLinks.find((h) => h.split("/").length >= 4) ?? docsLinks[0] ?? "/docs";
await probe.close();
console.log("docs page:", docsPage);

const only = process.argv[2]?.split(",");
const variants = VARIANTS.filter((v) => !only || only.includes(v.name));
const CONCURRENCY = 3;
const all = [];
for (let i = 0; i < variants.length; i += CONCURRENCY) {
  const batch = variants.slice(i, i + CONCURRENCY);
  const res = await Promise.all(batch.map((v) => runVariant(browser, v, docsPage)));
  res.forEach((r) => all.push(...r));
}
writeFileSync(`${OUT}/index-${only ? only.join("+") : "all"}.json`, JSON.stringify(all, null, 2));
await browser.close();
console.log("done", all.length);
