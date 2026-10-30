import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" };
const context = await browser.newContext({ ...phone, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    // client-only device state of this throwaway context: pretend this is the 3rd session
    if (!localStorage.getItem("jigswap.installTip")) localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 3, snoozedUntil: null, never: false }));
  } catch {}
});
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const tipShown = await page.evaluate(() => !!document.getElementById("install-app-tip"));
  console.log("tip on dashboard:", tipShown);
  // client-side navigation via the quick setup row link (navigation only)
  await page.locator('a[href="/welcome?step=solves"]').first().click();
  await page.waitForURL(/welcome/);
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const tip = document.getElementById("install-app-tip");
    const cont = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Continue");
    const skip = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Skip");
    const r = (el) => el ? (({top,bottom,left,right}) => ({top:Math.round(top),bottom:Math.round(bottom),left:Math.round(left),right:Math.round(right)}))(el.getBoundingClientRect()) : null;
    const c = cont?.getBoundingClientRect();
    const hit = c ? document.elementFromPoint(c.left + c.width/2, c.top + c.height/2) : null;
    return { url: location.pathname + location.search, tip: r(tip), cont: r(cont), skip: r(skip), hitOnContinue: hit ? `${hit.tagName} ${hit.closest('#install-app-tip') ? '(inside tip)' : ''} ${(hit.innerText||'').slice(0,30)}` : null };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: "/tmp/jigswap-review/agents/ONB/mobile__welcome_with_tip.jpg", type: "jpeg", quality: 75 });
  // scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(800);
  const info2 = await page.evaluate(() => {
    const cont = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Continue");
    const c = cont?.getBoundingClientRect();
    const hit = c ? document.elementFromPoint(c.left + c.width/2, c.top + c.height/2) : null;
    return { cont: c ? [Math.round(c.top), Math.round(c.bottom)] : null, hit: hit ? `${hit.tagName} ${hit.closest('#install-app-tip') ? '(inside tip)' : ''} ${(hit.innerText||'').slice(0,30)}` : null, docH: document.documentElement.scrollHeight };
  });
  console.log("after scroll", JSON.stringify(info2));
  await page.screenshot({ path: "/tmp/jigswap-review/agents/ONB/mobile__welcome_with_tip_bottom.jpg", type: "jpeg", quality: 75 });
} finally {
  await context.close();
  await browser.close();
}
