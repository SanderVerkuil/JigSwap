import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/A11Y";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const desc = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "BODY";
  const name = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g," ").slice(0, 40);
  const s=getComputedStyle(el);
  return `${el.tagName.toLowerCase()} "${name}" outline=${s.outlineStyle}/${s.outlineWidth}/${s.outlineColor} expanded=${el.getAttribute('aria-expanded')}`;
});
try {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const lm = await page.evaluate(()=>[...document.querySelectorAll('header,nav,main,footer,aside')].map(e=>`${e.tagName.toLowerCase()}[${e.getAttribute('aria-label')||''}]`));
  console.log('landmarks', lm);
  const cookie = await page.evaluate(()=>{const d=[...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-live],section,div')].find(e=>/cookie/i.test(e.innerText||'') && e.innerText.length<600 && e.getBoundingClientRect().height>40); return d? `${d.tagName} role=${d.getAttribute('role')} label=${d.getAttribute('aria-label')} text=${d.innerText.slice(0,160).replace(/\n/g,' / ')}`:'none'});
  console.log('cookie:', cookie);
  for (let i=0;i<10;i++){ await page.keyboard.press("Tab"); console.log(i+1, await desc()); if(i===1) await page.screenshot({path: OUT+'/pub-tab2.jpg', type:'jpeg', quality:70, clip:{x:0,y:0,width:1440,height:300}}); }
  // canvas a11y
  const cv = await page.evaluate(()=>[...document.querySelectorAll('canvas')].map(c=>`canvas aria-hidden=${c.getAttribute('aria-hidden')||c.closest('[aria-hidden]')?.getAttribute('aria-hidden')} role=${c.getAttribute('role')} label=${c.getAttribute('aria-label')} tabindex=${c.getAttribute('tabindex')}`));
  console.log('canvases', cv);
  // mobile menu button
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mb = page.locator('header button[aria-label]').last();
  console.log('menu btn:', await mb.getAttribute('aria-label'), 'expanded=', await mb.getAttribute('aria-expanded'), 'controls=', await mb.getAttribute('aria-controls'));
} finally { await context.close(); await browser.close(); }
