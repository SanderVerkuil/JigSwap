// READ-ONLY interaction checks for SOC (people / profile / members / notifications).
// No writes: only goto, scroll, typing into a SEARCH box, opening menus/local edit form, screenshots.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";

const BASE = "http://localhost:3001";
const OUT = "/tmp/jigswap-review/agents/SOC";
const VPS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const which = process.argv[2] ?? "all";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

async function withPage(vp, fn) {
  const context = await browser.newContext({
    ...VPS[vp],
    storageState: "/tmp/jigswap-review/tools/auth.json",
  });
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
    } catch {}
  });
  const page = await context.newPage();
  try {
    await fn(page);
  } catch (e) {
    console.log("ERR", vp, e.message);
  } finally {
    await context.close();
  }
}

async function hideInstallTip(page) {
  await page.evaluate(() => {
    for (const h of document.querySelectorAll("h2")) {
      if (/home screen|beginscherm/i.test(h.textContent || "")) {
        let el = h;
        for (let i = 0; i < 8 && el; i++) {
          if (getComputedStyle(el).position === "fixed") {
            el.style.display = "none";
            break;
          }
          el = el.parentElement;
        }
      }
    }
  });
}

async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await hideInstallTip(page);
}

const shot = (page, name) =>
  page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 70 });

if (which === "all" || which === "people") {
  await withPage("mobile", async (page) => {
    await go(page, "/people?tab=find");
    await shot(page, "m-people-find");
    const input = page.getByRole("textbox").first();
    await input.click();
    await input.type("sa", { delay: 60 });
    await page.waitForTimeout(1500);
    await shot(page, "m-people-find-sa");
    const fs = await input.evaluate((el) => getComputedStyle(el).fontSize);
    console.log("find input font-size", fs);
    await input.fill("zzqx");
    await page.waitForTimeout(1500);
    await shot(page, "m-people-find-none");
    await go(page, "/people?tab=activity");
    await shot(page, "m-people-activity");
    // tabs scroll width
    const tabs = await page.evaluate(() => {
      const l = document.querySelector('[role="tablist"]');
      return l ? { sw: l.scrollWidth, cw: l.clientWidth, ox: getComputedStyle(l).overflowX } : null;
    });
    console.log("people tablist", JSON.stringify(tabs));
  });
}

if (which === "all" || which === "profile") {
  await withPage("mobile", async (page) => {
    await go(page, "/profile");
    const nameBox = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].find((x) => /Henk/.test(x.textContent || ""));
      if (!h) return null;
      const r = h.getBoundingClientRect();
      const btn = [...document.querySelectorAll("button")].find((b) => /Edit Profile/.test(b.textContent || ""));
      const br = btn?.getBoundingClientRect();
      return { h2: { l: r.left, r: r.right, w: r.width, sw: h.scrollWidth, cw: h.clientWidth }, btn: br && { l: br.left, r: br.right, t: br.top } };
    });
    console.log("profile name vs edit btn", JSON.stringify(nameBox));
    await page.getByRole("button", { name: "Edit Profile" }).click();
    await page.waitForTimeout(800);
    await shot(page, "m-profile-edit-01");
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll("input,textarea")].map((el) => `${el.id || el.name} ${getComputedStyle(el).fontSize}`),
    );
    console.log("edit inputs", inputs.join(" | "));
    await page.mouse.wheel(0, 700);
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(500);
    await shot(page, "m-profile-edit-02");
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(500);
    await shot(page, "m-profile-edit-03");
  });
}

if (which === "all" || which === "member") {
  await withPage("mobile", async (page) => {
    await go(page, "/members/sander");
    const more = page.getByRole("button", { name: /more|meer|actions/i }).first();
    console.log("more btn label:", await more.getAttribute("aria-label"));
    await more.click();
    await page.waitForTimeout(600);
    await shot(page, "m-member-more-menu");
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()),
    );
    console.log("menu items", items.join(" | "));
    await page.keyboard.press("Escape");
  });
}

if (which === "all" || which === "prefs") {
  await withPage("desktop", async (page) => {
    await go(page, "/notifications/preferences");
    const info = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      const grid = aside?.parentElement;
      return {
        asidePos: aside && getComputedStyle(aside).position,
        asideBg: aside && getComputedStyle(aside).backgroundColor,
        gridCols: grid && getComputedStyle(grid).gridTemplateColumns,
        gridWidth: grid && grid.getBoundingClientRect().width,
      };
    });
    console.log("prefs layout", JSON.stringify(info));
    const region = await page.$('[data-scroll-restoration-id="app-content"]');
    await region.evaluate((el) => el.scrollBy(0, 900));
    await page.waitForTimeout(600);
    await shot(page, "d-prefs-scrolled");
  });
}

await browser.close();
