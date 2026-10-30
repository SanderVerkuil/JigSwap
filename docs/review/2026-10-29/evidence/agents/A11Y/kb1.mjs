// READ-ONLY keyboard checks on desktop /dashboard.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/A11Y";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {}
});
const page = await context.newPage();
const desc = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return "BODY";
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g," ").slice(0, 40);
  const vis = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  const inDialog = !!el.closest('[role="dialog"]');
  return `${el.tagName.toLowerCase()}${el.getAttribute("role")?`[role=${el.getAttribute("role")}]`:""} "${name}" visibleFocus=${vis} outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow.slice(0,40)} at=${Math.round(r.x)},${Math.round(r.y)} ${r.width|0}x${r.height|0}${inDialog?" IN-DIALOG":""}`;
});
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // Landmarks + headings via accessibility snapshot
  const lm = await page.evaluate(() => {
    const out=[];
    document.querySelectorAll('header,nav,main,aside,footer,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=region],section[aria-label],section[aria-labelledby]').forEach(e=>{
      const s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden') return;
      out.push(`${e.tagName.toLowerCase()} role=${e.getAttribute('role')||''} label=${e.getAttribute('aria-label')||''}`);
    });
    const hs=[...document.querySelectorAll('h1,h2,h3,h4')].filter(h=>{const r=h.getBoundingClientRect(); const s=getComputedStyle(h); return !(s.display==='none') && h.offsetParent!==null || h.closest('.sr-only')}).map(h=>`${h.tagName} ${h.innerText.trim().slice(0,40)} vis=${h.offsetParent!==null}`);
    return {out, hs};
  });
  console.log("LANDMARKS:", lm.out.join(" | "));
  console.log("HEADINGS:", lm.hs.join(" | "));
  console.log("--- TAB ORDER /dashboard");
  for (let i = 0; i < 32; i++) {
    await page.keyboard.press("Tab");
    console.log(String(i+1).padStart(2), await desc());
    if (i === 0) await page.screenshot({ path: OUT + "/dash-tab1.jpg", type: "jpeg", quality: 70 });
    if (i === 20) await page.screenshot({ path: OUT + "/dash-tab21.jpg", type: "jpeg", quality: 70 });
  }
  // Command palette: Ctrl+K
  await page.locator("body").click({ position: { x: 700, y: 880 } }).catch(()=>{});
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(600);
  console.log("--- PALETTE OPEN focus:", await desc());
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return "no dialog";
    const lb = d.getAttribute("aria-labelledby"); const db = d.getAttribute("aria-describedby");
    const t = lb && document.getElementById(lb); const de = db && document.getElementById(db);
    return `dialog labelledby=${lb}->${t?t.textContent:'MISSING'} (inside=${t?d.contains(t):'-'}) describedby->${de?de.textContent:'MISSING'} aria-modal=${d.getAttribute('aria-modal')}`;
  });
  console.log(dlg);
  await page.screenshot({ path: OUT + "/palette.jpg", type: "jpeg", quality: 70 });
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); console.log("  palette tab", i+1, await desc()); }
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  console.log("  active option:", await page.evaluate(()=>{const s=document.querySelector('[cmdk-item][data-selected=true]'); const inp=document.querySelector('[cmdk-input]'); return (s?s.textContent:'none')+' aria-activedescendant='+(inp&&inp.getAttribute('aria-activedescendant'));}));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  console.log("--- after Escape: dialog?", await page.evaluate(()=>!!document.querySelector('[role="dialog"]')), "focus:", await desc());
} finally {
  await context.close();
  await browser.close();
}
