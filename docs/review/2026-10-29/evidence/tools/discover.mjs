import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "auth.json" });
const page = await context.newPage();
const lists = ["/dashboard","/my-puzzles","/library","/puzzles","/browse","/circles","/messages","/collections","/people","/community","/household","/trades","/borrowed","/completions","/notifications","/admin","/admin/users","/admin/puzzles","/admin/puzzles/proposals","/catalog","/profile"];
const all = new Set();
for (const p of lists) {
  try {
    await page.goto("http://localhost:3001" + p, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    const hrefs = await page.locator("a[href^='/']").evaluateAll(as => as.map(a => a.getAttribute("href")));
    console.log(p, "->", page.url().replace("http://localhost:3001",""), hrefs.length);
    hrefs.forEach(h => all.add(h));
  } catch (e) { console.log(p, "ERR", e.message.split("\n")[0]); }
}
console.log([...all].sort().join("\n"));
await context.close(); await browser.close();
