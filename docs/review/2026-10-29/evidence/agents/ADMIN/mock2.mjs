// READ-ONLY layout probe #2: client-side DOM replicas of the admin image-compare dialog and the
// Edit & Approve dialog (DialogContent classes copied verbatim) at 390x844. No server writes.
import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");

const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/ADMIN";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

const DC =
  "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg";
// A portrait box-art stand-in (3:4) so object-contain fills the width like a real cover.
const img = (label) =>
  `<div class="bg-muted max-h-[60vh] w-full rounded-lg border" style="aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:20px">${label}</div>`;
const compare = `<div class="fixed inset-0 z-50 bg-black/50"></div><div class="${DC} sm:max-w-3xl" data-probe="dlg">
<button class="absolute top-4 right-4 rounded-xs opacity-70" data-probe="close">X</button>
<div class="flex flex-col gap-2 text-center sm:text-left"><h2 class="text-lg leading-none font-semibold">Afbeeldingen vergelijken</h2><p class="text-muted-foreground text-sm">Links de huidige afbeelding, rechts de voorgestelde vervanging.</p></div>
<div class="flex gap-1" data-probe="pills"><span class="rounded-full border px-3 py-1 text-sm">Naast elkaar</span><span class="rounded-full border px-3 py-1 text-sm">Overlappend</span></div>
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2"><figure class="space-y-1"><figcaption class="text-muted-foreground text-xs">Huidig</figcaption>${img("CURRENT")}</figure><figure class="space-y-1" data-probe="proposed"><figcaption class="text-muted-foreground text-xs">Voorgesteld</figcaption>${img("PROPOSED")}</figure></div>
</div>`;

const field = (label, control) =>
  `<div class="grid gap-2"><label class="text-sm font-medium">${label}</label>${control}</div>`;
const input = `<input class="border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base md:text-sm">`;
const editApprove = `<div class="fixed inset-0 z-50 bg-black/50"></div><div class="${DC} sm:max-w-md" data-probe="dlg">
<button class="absolute top-4 right-4 rounded-xs opacity-70" data-probe="close">X</button>
<div class="flex flex-col gap-2 text-center sm:text-left"><h2 class="text-lg leading-none font-semibold">Bewerken &amp; goedkeuren</h2><p class="text-muted-foreground text-sm">Corrigeer de gegevens van de inzending en sla op om deze in één stap goed te keuren en te publiceren.</p></div>
<form class="space-y-4">
${field("Titel", input)}
${field("Beschrijving", `<textarea class="border-input flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base md:text-sm"></textarea>`)}
<div class="grid grid-cols-2 gap-4">${field("Merk", input)}${field("Uitgever", input)}${field("Aantal stukjes", input)}</div>
${field("Moeilijkheid", `<button class="border-input flex h-9 w-full items-center rounded-md border px-3 text-sm">Kies…</button>`)}
${field("Tags", input)}
</form>
<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end" data-probe="footer"><button class="h-9 rounded-md border px-4">Annuleren</button><button class="h-9 rounded-md bg-primary text-primary-foreground px-4">Opslaan &amp; goedkeuren</button></div>
</div>`;

const out = {};
for (const [vname, opts] of Object.entries({
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  mobileKeyboard: { viewport: { width: 390, height: 500 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})) {
  const context = await browser.newContext({ ...opts, storageState: "/tmp/jigswap-review/tools/auth.json" });
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    for (const [mname, html] of Object.entries({ compare, editApprove })) {
      out[`${vname}/${mname}`] = await page.evaluate((html) => {
        document.querySelectorAll("[data-mock]").forEach((n) => n.remove());
        const host = document.createElement("div");
        host.setAttribute("data-mock", "1");
        host.innerHTML = html;
        document.body.appendChild(host);
        const r = (sel) => {
          const el = host.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
        };
        return { vh: innerHeight, dlg: r('[data-probe="dlg"]'), close: r('[data-probe="close"]'), pills: r('[data-probe="pills"]'), proposed: r('[data-probe="proposed"]'), footer: r('[data-probe="footer"]') };
      }, html);
      await page.screenshot({ path: `${OUT}/mock2-${vname}-${mname}.jpg`, type: "jpeg", quality: 75 });
    }
  } finally {
    await context.close();
  }
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
