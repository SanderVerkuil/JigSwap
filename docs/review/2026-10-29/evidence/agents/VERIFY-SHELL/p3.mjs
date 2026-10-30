import { createRequire } from "node:module";
const require = createRequire("/tmp/jigswap-review/tools/package.json");
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/VERIFY-SHELL";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
try {
  for (const [w, h] of [[820, 1180], [1024, 768], [1180, 820], [1280, 800]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1200, hasTouch: w < 1200, storageState: "/tmp/jigswap-review/tools/auth.json" });
    await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
    const p = await c.newPage();
    await p.goto(BASE + "/messages/04e0cd32-b61f-48f9-98e1-c25d9de34c28", { waitUntil: "networkidle" }); await p.waitForTimeout(2500);
    const info = await p.evaluate(() => {
      const ta = document.querySelector("main textarea");
      const tb = ta?.getBoundingClientRect();
      const sb = document.querySelector('[data-slot="sidebar"][data-state]');
      return `sidebar=${sb?.getAttribute("data-state")} textarea w=${tb ? Math.round(tb.width) : "-"} h=${tb ? Math.round(tb.height) : "-"}`;
    });
    console.log(w, info);
    if (w === 820) await p.screenshot({ path: OUT + "/t820_thread.jpg", type: "jpeg", quality: 70 });
    await c.close();
  }
} finally { await browser.close(); }
