import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SHARE";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
async function ctx(opts, locale) {
  const c = await browser.newContext({ ...opts, storageState: "/tmp/jigswap-review/tools/auth.json" });
  await c.addInitScript((loc) => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
      localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true }));
    } catch {}
  }, locale);
  return c;
}
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const c = await ctx(mobile);
const page = await c.newPage();
try {
  for (const tab of ["members", "sharing", "settings"]) {
    await page.goto(BASE + "/household?tab=" + tab, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/m_household_${tab}.jpg`, type: "jpeg", quality: 70, fullPage: true });
    const info = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, text: document.querySelector("main")?.innerText.slice(0, 1500) }));
    console.log("== household", tab, info.h, "\n", info.text);
  }
  // Invite dialog from Puzzles tab (open only)
  await page.goto(BASE + "/household", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Invite" }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/m_household_invite_dialog.jpg`, type: "jpeg", quality: 70 });
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const inputs = [...(d?.querySelectorAll("input,select,textarea") ?? [])].map((i) => `${i.type} ${i.placeholder} fs=${getComputedStyle(i).fontSize}`);
    return { text: d?.innerText.slice(0, 1200), inputs, sh: d?.scrollHeight, ch: d?.clientHeight };
  });
  console.log("== invite dialog", JSON.stringify(dlg, null, 1));
  await page.keyboard.press("Escape");

  // Create circle dialog (open only)
  await page.goto(BASE + "/circles", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Create Circle" }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/m_circles_create_dialog.jpg`, type: "jpeg", quality: 70 });
  const cd = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { text: d?.innerText, inputs: [...(d?.querySelectorAll("input") ?? [])].map((i) => `fs=${getComputedStyle(i).fontSize} h=${i.getBoundingClientRect().height}`) };
  });
  console.log("== create circle", JSON.stringify(cd));
  await page.keyboard.press("Escape");

  // Circle detail: tap first avatar to see tooltip
  await page.goto(BASE + "/circles/3e51e703-87d4-435a-91d7-29327390e7b1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const av = page.locator('[role="group"] button').first();
  await av.tap();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/m_circle_avatar_tap.jpg`, type: "jpeg", quality: 70 });
  const tip = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"],[data-radix-popper-content-wrapper]')].map((e) => e.textContent));
  console.log("== avatar tooltip", tip);
} finally {
  await c.close();
  await browser.close();
}
