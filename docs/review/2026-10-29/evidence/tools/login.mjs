// Signs the dev test account in once and saves the session for the capture script.
// Usage: node login.mjs <password-file>
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const password = readFileSync(process.argv[2], "utf8").trim();
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://localhost:3001/sign-in", { waitUntil: "networkidle" });
if (await page.getByRole("button", { name: "Decline", exact: true }).isVisible()) await page.getByRole("button", { name: "Decline", exact: true }).click();
await page.locator('input[name="identifier"]').fill("s.verkuil+dev@pm.me");
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.locator('input[name="password"]').waitFor({ timeout: 20000 });
await page.locator('input[name="password"]').fill(password);
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 });
await page.waitForTimeout(3000);
console.log("signed in, at", page.url());
await context.storageState({ path: "/tmp/jigswap-review/tools/auth.json" });
await context.close();
await browser.close();
