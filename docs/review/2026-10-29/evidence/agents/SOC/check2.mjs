// READ-ONLY: open the local Edit Profile form (no save) and measure overflow of its controls.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";

const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOC";
const vpName = process.argv[2] ?? "mobile";
const VPS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  ...VPS[vpName],
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
  } catch {}
});
const page = await context.newPage();
try {
  await page.goto(BASE + "/profile", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    for (const h of document.querySelectorAll("h2")) {
      if (/home screen/i.test(h.textContent || "")) {
        let el = h;
        for (let i = 0; i < 8 && el; i++) {
          if (getComputedStyle(el).position === "fixed") { el.style.display = "none"; break; }
          el = el.parentElement;
        }
      }
    }
  });
  await page.getByRole("button", { name: "Edit Profile" }).click();
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), t: Math.round(r.top + window.scrollY) };
    };
    const saveBtn = [...document.querySelectorAll("button")].find((b) => /^\s*Save\s*$/.test(b.textContent || ""));
    const sr = saveBtn?.getBoundingClientRect();
    const editDialogBtn = [...document.querySelectorAll("button")].find((b) => /^\s*Edit\s*$/.test(b.textContent || ""));
    const er = editDialogBtn?.getBoundingClientRect();
    const region = document.querySelector('[data-scroll-restoration-id="app-content"]');
    return {
      vw,
      regionScrollWidth: region?.scrollWidth,
      username: pick("#profile-username"),
      slug: pick("#profile-slug"),
      bio: pick("#profile-bio"),
      visibilitySwitch: pick("#profile-visibility"),
      save: sr && { l: Math.round(sr.left), r: Math.round(sr.right) },
      displayNameEdit: er && { l: Math.round(er.left), r: Math.round(er.right) },
    };
  });
  console.log(JSON.stringify(res, null, 1));
  await page.evaluate(() => window.scrollTo(0, 560));
  const sw = null;
  if (sw) {
    await sw.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${OUT}/${vpName}-profile-edit-visibility.jpg`, type: "jpeg", quality: 70 });
} finally {
  await context.close();
  await browser.close();
}
