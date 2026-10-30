// READ-ONLY layout probe: loads a signed-in page (for the app's compiled Tailwind CSS + shell),
// then replaces the content area's DOM client-side with replicas of admin markup (classes copied
// verbatim from the admin components) to measure layout at 390 / 820 / 1440. No clicks, no
// server writes — DOM changes are local to this browser context.
import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/ADMIN";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

const svg = (cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16"/></svg>`;
const BTN =
  "items-center justify-center whitespace-nowrap text-sm font-medium transition-all shrink-0 outline-none border bg-background shadow-xs h-8 rounded-md px-3 has-[>svg]:px-2.5";

const catRow = (name, desc, edit, deact) => `
<div class="flex items-center gap-3 border-b px-4 py-3 last:border-0" data-probe="catrow">
  <button type="button" class="shrink-0 cursor-grab touch-none rounded text-muted-foreground" data-probe="grip">${svg("h-4 w-4")}</button>
  <span class="h-9 w-9 shrink-0 rounded-lg border" style="background-color:#7c3aed"></span>
  <div class="min-w-0 flex-1 space-y-0.5" data-probe="catname">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span class="font-semibold">${name}</span><span class="inline-flex opacity-50">${svg("h-2.5 w-3.5")}</span></div>
    <p class="truncate text-sm text-muted-foreground">${desc}</p>
  </div>
  <div class="flex shrink-0 items-center gap-2">
    <button class="${BTN} flex items-center gap-1">${svg("h-3 w-3")}${edit}</button>
    <button class="${BTN} flex items-center gap-1 text-destructive">${svg("h-3 w-3")}${deact}</button>
  </div>
</div>`;

const categoriesNL = `<div class="space-y-6"><div class="rounded-xl border bg-card">
${catRow("Landschappen", "Bergen, meren en weidse vergezichten", "Bewerken", "Deactiveren")}
${catRow("Kunst &amp; schilderijen", "Klassieke en moderne kunstwerken", "Bewerken", "Deactiveren")}
${catRow("Steden &amp; architectuur", "Skylines, straten en gebouwen", "Bewerken", "Deactiveren")}
</div></div>`;
const categoriesEN = `<div class="space-y-6"><div class="rounded-xl border bg-card">
${catRow("Landscapes", "Mountains, lakes and wide vistas", "Edit", "Deactivate")}
${catRow("Art &amp; paintings", "Classic and modern artworks", "Edit", "Deactivate")}
${catRow("Cities &amp; architecture", "Skylines, streets and buildings", "Edit", "Deactivate")}
</div></div>`;

const userRow = (name, user, email) => `
<tr class="border-b last:border-0">
  <td class="px-4 py-3"><a class="flex items-center gap-3"><span class="size-8 shrink-0 rounded-full bg-muted"></span><div><div class="font-medium">${name}</div><div class="text-xs text-muted-foreground">@${user}</div></div></a></td>
  <td class="px-4 py-3 text-muted-foreground">${email}</td>
  <td class="px-4 py-3 text-muted-foreground">12 mrt 2026</td>
  <td class="px-4 py-3"><span class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 border-transparent bg-secondary text-secondary-foreground">Actief</span></td>
  <td class="px-4 py-3"></td>
  <td class="px-4 py-3 text-right tabular-nums">14</td>
  <td class="px-4 py-3 text-right"><div class="flex items-center justify-end gap-2"><a class="inline-flex ${BTN} size-9 px-0">${svg("size-4")}</a><button class="inline-flex ${BTN}" data-probe="makeadmin">Beheerder maken</button></div></td>
</tr>`;
const users = `<div class="space-y-4"><div class="relative max-w-sm"><input class="border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base md:text-sm pl-9" placeholder="Zoek op naam of gebruikersnaam…"></div>
<div class="overflow-x-auto rounded-xl border bg-card" data-probe="usertable"><table class="w-full text-sm"><thead><tr class="border-b text-left text-muted-foreground">
<th class="px-4 py-3 font-medium">Lid</th><th class="px-4 py-3 font-medium">E-mail</th><th class="px-4 py-3 font-medium">Lid sinds</th><th class="px-4 py-3 font-medium">Status</th><th class="px-4 py-3 font-medium">Rol</th><th class="px-4 py-3 text-right font-medium">Exemplaren</th><th class="px-4 py-3"></th></tr></thead><tbody>
${userRow("Henk Pieterszoon", "henkp", "henk.pieterszoon@example-mail.nl")}
${userRow("Marieke van der Berg-Jansen", "marieke", "marieke.vanderberg@puzzelvereniging.nl")}
${userRow("Jan", "jan", "jan@x.nl")}
</tbody></table></div></div>`;

const contact = `<div class="rounded-xl border bg-card"><div class="flex flex-col gap-3 border-b px-4 py-3 last:border-0">
<div class="space-y-1"><div class="flex items-center justify-between gap-2"><span class="font-semibold">Wilhelmina Koppelaar</span><div class="flex items-center gap-2"><span class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 text-foreground">Lenen of ruilen</span><span class="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 border-transparent bg-primary text-primary-foreground">Nieuw</span></div></div>
<p class="text-sm text-muted-foreground"><a class="underline">wilhelmina.koppelaar-vanderhoeven@puzzelclubnederland.example.nl</a> • 3 okt 2026 14:02 • nl</p></div>
<p class="text-sm whitespace-pre-wrap" data-probe="contactmsg">Mijn ruil is niet aangekomen, zie https://jigswap.site/trades/k57d9a8f1c2b3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0 graag hulp.</p>
<button class="inline-flex ${BTN} flex items-center gap-1 self-start">${svg("h-3 w-3")}Markeren als afgehandeld</button>
</div></div>`;

const qRow = (i, active) => `<button type="button" class="flex w-full items-center gap-3 border-b border-l-2 px-3 py-3 text-left last:border-b-0 ${active ? "border-l-primary bg-primary/5" : "border-l-transparent"}" data-probe="qrow${i}">
<span class="relative block shrink-0 overflow-hidden rounded-lg size-11 bg-muted"></span>
<span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold">Submission ${i} — Starry Night 1000</span><span class="mt-0.5 block truncate text-xs text-muted-foreground">Ravensburger · 1000 pieces</span></span>
<span class="shrink-0 text-xs text-muted-foreground">${i}h ago</span></button>`;
const queue = (n) => `<div class="space-y-6">
<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">${["Goedgekeurd", "Afgekeurd", "Meldingen afgehandeld", "Gem. beoordelingstijd"]
  .map(
    (l) => `<div class="flex items-center gap-3 rounded-xl border bg-card px-4 py-4"><span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"></span><div class="min-w-0"><div class="text-2xl leading-none font-bold">12</div><div class="mt-1 truncate text-xs text-muted-foreground" data-probe="kpilabel">${l} <span class="opacity-70">· deze week</span></div></div></div>`,
  )
  .join("")}</div>
<div class="flex flex-col items-start gap-4 lg:grid lg:grid-cols-[360px_1fr]">
<div class="w-full self-stretch overflow-hidden rounded-xl border bg-card lg:self-start">${Array.from({ length: n }, (_, i) => qRow(i + 1, i === n - 1)).join("")}</div>
<div class="w-full min-w-0 rounded-xl border bg-card p-5" data-probe="detail"><h3 class="text-xl font-bold">Submission ${n} — Starry Night 1000</h3><div style="height:220px" class="bg-muted rounded-xl mt-3"></div><div class="flex flex-wrap items-center gap-2.5 pt-1 mt-3"><button class="inline-flex ${BTN}" data-probe="approve">Goedkeuren &amp; publiceren</button></div></div>
</div></div>`;

const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const results = {};
for (const [vname, opts] of Object.entries(variants)) {
  const context = await browser.newContext({ ...opts, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    } catch {}
  });
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const mocks = { categoriesNL, categoriesEN, users, contact, queue: queue(8) };
    for (const [mname, html] of Object.entries(mocks)) {
      const m = await page.evaluate((html) => {
        const area = document.querySelector('div[class*="pt-[18px]"]');
        if (!area) return { error: "no content area" };
        area.innerHTML = html;
        const r = (sel) => {
          const el = area.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), sw: el.scrollWidth, cw: el.clientWidth };
        };
        return {
          areaW: Math.round(area.getBoundingClientRect().width),
          docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          catname: r('[data-probe="catname"]'),
          grip: r('[data-probe="grip"]'),
          usertable: r('[data-probe="usertable"]'),
          makeadmin: r('[data-probe="makeadmin"]'),
          contactmsg: r('[data-probe="contactmsg"]'),
          detail: r('[data-probe="detail"]'),
          qrow8: r('[data-probe="qrow8"]'),
          kpi: [...area.querySelectorAll('[data-probe="kpilabel"]')].map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, txt: e.innerText })),
          innerH: window.innerHeight,
        };
      }, html);
      results[`${vname}/${mname}`] = m;
      await page.evaluate(() => window.scrollTo(0, 0));
      const scroller = await page.evaluate(() => {
        // md+ scrolls inside an inner region; reset it too
        document.querySelectorAll("*").forEach((el) => {
          if (el.scrollTop > 0) el.scrollTop = 0;
        });
        return true;
      });
      void scroller;
      await page.screenshot({ path: `${OUT}/mock-${vname}-${mname}.jpg`, type: "jpeg", quality: 75 });
    }
  } finally {
    await context.close();
  }
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
