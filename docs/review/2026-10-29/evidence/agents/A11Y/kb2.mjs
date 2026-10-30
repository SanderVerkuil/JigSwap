import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/A11Y";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
const desc = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "BODY";
  const r = el.getBoundingClientRect();
  const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g," ").slice(0, 50);
  return `${el.tagName.toLowerCase()}${el.getAttribute("role")?`[role=${el.getAttribute("role")}]`:""} "${name}" at=${Math.round(r.x)},${Math.round(r.y)} ${r.width|0}x${r.height|0}${el.closest('[role="dialog"]')?" IN-DIALOG":""}`;
});
try {
  // 1) Palette via the search pill (Enter on the pill opens a dialog, no data write)
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  for (let i=0;i<3;i++) await page.keyboard.press("Tab");
  console.log("on:", await desc());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  console.log("palette focus:", await desc());
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  console.log("after Esc focus returns to:", await desc());
  // 2) Notification popover via keyboard
  await page.keyboard.press("Tab"); console.log("on:", await desc());
  await page.keyboard.press("Enter"); await page.waitForTimeout(800);
  console.log("popover focus:", await desc());
  const pop = await page.evaluate(()=>{const d=document.querySelector('[data-slot="popover-content"]'); return d? `role=${d.getAttribute('role')} labelledby=${d.getAttribute('aria-labelledby')} label=${d.getAttribute('aria-label')} text=${d.innerText.slice(0,120).replace(/\n/g,' / ')}`:'none'});
  console.log(pop);
  await page.screenshot({ path: OUT + "/bell-popover.jpg", type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  console.log("after Esc:", await desc());
  // 3) language menu
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); console.log("on:", await desc());
  await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  const menu = await page.evaluate(()=>[...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(e=>`${e.getAttribute('role')} "${e.innerText}" checked=${e.getAttribute('aria-checked')} lang=${e.getAttribute('lang')||e.querySelector('[lang]')?.getAttribute('lang')||''}`));
  console.log("lang menu:", menu);
  await page.screenshot({ path: OUT + "/lang-menu.jpg", type: "jpeg", quality: 70, clip:{x:1000,y:0,width:440,height:250} });
  await page.keyboard.press("Escape");
  // 4) Message thread tab order
  await page.goto(BASE + "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const sem = await page.evaluate(()=>{
    const ol=document.querySelector('ol[aria-label]');
    const lis = ol? [...ol.children].map(li=>li.innerText.replace(/\s+/g,' ').slice(0,60)) : [];
    const ta=document.querySelector('textarea');
    const lab = ta && (ta.getAttribute('aria-label') || (ta.labels&&ta.labels[0]&&ta.labels[0].innerText));
    const live=[...document.querySelectorAll('[aria-live]')].map(e=>`${e.getAttribute('aria-live')}:${e.className.slice(0,30)}`);
    const times=[...document.querySelectorAll('time')].map(t=>`${t.getAttribute('datetime')} "${t.innerText}"`);
    return {olLabel: ol&&ol.getAttribute('aria-label'), lis, lab, live, times, inboxList: [...document.querySelectorAll('[aria-current]')].map(a=>a.tagName+':'+a.getAttribute('aria-current')+':'+a.innerText.slice(0,30).replace(/\n/g,' '))};
  });
  console.log(JSON.stringify(sem,null,1));
  console.log("--- TAB ORDER thread");
  for (let i=0;i<40;i++){ await page.keyboard.press("Tab"); const d=await desc(); if(i>=22) console.log(String(i+1).padStart(2), d); }
  await page.screenshot({ path: OUT + "/thread-tab.jpg", type: "jpeg", quality: 70 });
} finally { await context.close(); await browser.close(); }
