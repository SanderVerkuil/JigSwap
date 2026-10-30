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
  const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g," ").slice(0, 50);
  return `${el.tagName.toLowerCase()}${el.getAttribute("role")?`[role=${el.getAttribute("role")}]`:""} "${name}"${el.closest('[role="dialog"]')?" IN-DIALOG":""}`;
});
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  // palette via pill, Escape, wait longer
  const pill = page.locator('header button', { hasText: /Search puzzles/ });
  await pill.focus(); console.log("focused:", await desc());
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  console.log("open:", await desc());
  await page.keyboard.press("Escape"); await page.waitForTimeout(1200);
  console.log("after Esc (1.2s):", await desc());
  // bell
  const bell = page.locator('button[data-slot="popover-trigger"]').first();
  await bell.focus(); console.log("focused:", await desc(), "| aria-label=", await bell.getAttribute('aria-label'), "| expanded=", await bell.getAttribute('aria-expanded'));
  await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  console.log("popover focus:", await desc());
  const pop = await page.evaluate(()=>{const d=document.querySelector('[data-slot="popover-content"]'); return d? `role=${d.getAttribute('role')} labelledby=${d.getAttribute('aria-labelledby')} label=${d.getAttribute('aria-label')} text=${d.innerText.slice(0,200).replace(/\n/g,' / ')}`:'none'});
  console.log(pop);
  await page.screenshot({ path: OUT + "/bell-popover.jpg", type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  console.log("after Esc:", await desc());
  // language menu
  const lang = page.locator('header button', { hasText: 'Switch language' });
  await lang.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
  const menu = await page.evaluate(()=>[...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(e=>`${e.getAttribute('role')} "${e.innerText}" checked=${e.getAttribute('aria-checked')} lang=${e.getAttribute('lang')||''}`));
  console.log("lang menu:", menu, "focus:", await desc());
  await page.screenshot({ path: OUT + "/lang-menu.jpg", type: "jpeg", quality: 70, clip:{x:1000,y:0,width:440,height:250} });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // theme menu
  const theme = page.locator('header button', { hasText: 'Toggle theme' });
  await theme.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(600);
  const tmenu = await page.evaluate(()=>[...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(e=>`${e.getAttribute('role')} "${e.innerText}" checked=${e.getAttribute('aria-checked')}`));
  console.log("theme menu:", tmenu);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // user menu
  const um = page.locator('button[aria-label="Open user menu"]');
  await um.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const umenu = await page.evaluate(()=>[...document.querySelectorAll('[role="menu"] [role^="menuitem"], [role="menu"] [role="menuitemradio"]')].map(e=>`${e.getAttribute('role')} "${e.innerText.replace(/\n/g,' ')}" checked=${e.getAttribute('aria-checked')}`));
  console.log("user menu:", umenu, "focus:", await desc());
  await page.screenshot({ path: OUT + "/user-menu.jpg", type: "jpeg", quality: 70 });
  await page.keyboard.press("Escape");
} finally { await context.close(); await browser.close(); }
