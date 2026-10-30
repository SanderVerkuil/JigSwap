import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SHARE";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const tablet = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
// Client-side only: injects mock rows copying ExchangeListRow's markup (trades.tsx:303-341). Nothing is sent to the server.
const ROWS = {
  en: [
    ["Trade · De Kattenshow", " ↔ Oostenrijk, Tirol, sellrainer berge", "outgoing · with Henk Pieterszoon · 3 days ago", "Pending", "bg-amber-500/15 text-amber-700"],
    ["Lend · Lam Gelegd", "", "incoming · with Sander Verkuil · 2 hours ago", "Accepted", "bg-jigsaw-primary/10 text-jigsaw-primary"],
    ["Sale · Ravensburger Neuschwanstein Castle 2000", "", "incoming · with Wilhelmina van der Berg-Hoogeveen · last week", "Disputed", "bg-amber-500/15 text-amber-700"],
  ],
  nl: [
    ["Ruil · De Kattenshow", " ↔ Oostenrijk, Tirol, sellrainer berge", "uitgaand · met Henk Pieterszoon · 3 dagen geleden", "In afwachting", "bg-amber-500/15 text-amber-700"],
    ["Uitleen · Lam Gelegd", "", "inkomend · met Sander Verkuil · 2 uur geleden", "Geaccepteerd", "bg-jigsaw-primary/10 text-jigsaw-primary"],
    ["Verkoop · Ravensburger Neuschwanstein Castle 2000", "", "inkomend · met Wilhelmina van der Berg-Hoogeveen · vorige week", "In geschil", "bg-amber-500/15 text-amber-700"],
  ],
};
async function run(device, locale, tag) {
  const auth = JSON.parse(readFileSync("/tmp/jigswap-review/tools/auth.json", "utf8"));
  auth.cookies = auth.cookies.filter((c) => c.name !== "jigswap-intl");
  auth.cookies.push({ name: "jigswap-intl", value: locale, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" });
  const c = await browser.newContext({ ...device, storageState: auth, locale: locale === "nl" ? "nl-NL" : "en-GB" });
  await c.addInitScript(() => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
      localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true }));
    } catch {}
  });
  const page = await c.newPage();
  try {
    await page.goto(BASE + "/trades", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const res = await page.evaluate((rows) => {
      const filterBtn = [...document.querySelectorAll('button[aria-pressed="false"]')].find((b) => b.className.includes("rounded-full"));
      const btnClass = filterBtn.className.replace("rounded-full", "");
      const empty = [...document.querySelectorAll("div")].find((d) => d.className?.includes?.("py-14"));
      const list = document.createElement("div");
      list.className = "flex flex-col";
      list.innerHTML = rows.map(([title, sec, meta, pill, tone], i) => `
        <div class="py-3 ${i < rows.length - 1 ? "border-b" : ""}">
          <div class="flex items-center gap-3.5">
            <span class="inline-flex shrink-0 items-center justify-center rounded-lg text-white" style="width:44px;height:44px;background:linear-gradient(150deg,#6048e8,#494e92)">⇄</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-semibold">${title}${sec ? `<span class="text-muted-foreground font-medium">${sec}</span>` : ""}</div>
              <div class="text-muted-foreground mt-0.5 truncate text-xs">${meta}</div>
            </div>
            <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${tone}">${pill}</span>
            <button class="${btnClass}">${document.documentElement.lang === "nl" ? "Bekijken" : "View"}</button>
          </div>
        </div>`).join("");
      empty.replaceWith(list);
      const out = [...list.querySelectorAll(".truncate.text-base")].map((el) => ({ text: el.textContent, visibleW: el.clientWidth, fullW: el.scrollWidth }));
      const btn = list.querySelector("button").getBoundingClientRect();
      return { out, btnH: btn.height, btnW: btn.width };
    }, ROWS[locale]);
    console.log(tag, JSON.stringify(res));
    await page.screenshot({ path: `${OUT}/${tag}_trades_mockrows.jpg`, type: "jpeg", quality: 75 });
  } finally {
    await c.close();
  }
}
try {
  await run(mobile, "en", "m_en");
  await run(mobile, "nl", "m_nl");
  await run(tablet, "en", "t_en");
} finally {
  await browser.close();
}
