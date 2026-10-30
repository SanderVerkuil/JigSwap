import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/A11Y";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const vis = e => { const s=getComputedStyle(e); return s.display!=='none' && s.visibility!=='hidden' && e.getClientRects().length>0; };
    const h1 = [...document.querySelectorAll('h1')].map(h=>`${h.innerText.slice(0,40)} visible=${vis(h)}`);
    const lm = [...document.querySelectorAll('header,nav,main,aside,footer,[role=navigation],[role=main]')].filter(vis).map(e=>`${e.tagName.toLowerCase()}[${e.getAttribute('aria-label')||''}]`);
    const tabs = [...document.querySelectorAll('nav a, nav button')].filter(vis).map(a=>`${a.tagName} name="${a.getAttribute('aria-label')||a.innerText}" text="${a.innerText}" ${a.getBoundingClientRect().width|0}x${a.getBoundingClientRect().height|0} current=${a.getAttribute('aria-current')}`);
    const bell = document.querySelector('a[href="/notifications"]');
    return {h1, lm, tabs, bell: bell && `${bell.getAttribute('aria-label')} dot=${!!bell.querySelector('span')}`};
  });
  console.log(JSON.stringify(info, null, 1));
  // open quick-actions sheet (+)
  await page.locator('nav button').first().tap();
  await page.waitForTimeout(800);
  const sheet = await page.evaluate(() => {
    const d=document.querySelector('[role="dialog"]'); if(!d) return 'no dialog';
    const lb=d.getAttribute('aria-labelledby'); const t=lb&&document.getElementById(lb);
    const items=[...d.querySelectorAll('a,button')].map(a=>`${a.tagName} "${(a.getAttribute('aria-label')||a.innerText).replace(/\n/g,' ').slice(0,40)}" ${a.getBoundingClientRect().height|0}h`);
    return {title: t&&t.textContent, items, focus: document.activeElement && (document.activeElement.getAttribute('aria-label')||document.activeElement.innerText||document.activeElement.tagName).slice(0,40)};
  });
  console.log(JSON.stringify(sheet, null, 1));
  await page.screenshot({ path: OUT + "/m-quicksheet.jpg", type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  // open search palette on mobile
  await page.locator('header button[aria-label]').first().tap();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "/m-palette.jpg", type: "jpeg", quality: 70 });
  const pal = await page.evaluate(()=>{const i=document.querySelector('[cmdk-input]'); return i? `input font=${getComputedStyle(i).fontSize} focused=${document.activeElement===i}`:'none'});
  console.log('palette', pal);
  await page.keyboard.press("Escape");
} finally { await context.close(); await browser.close(); }
