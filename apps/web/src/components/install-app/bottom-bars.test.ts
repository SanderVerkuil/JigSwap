import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { installTipBlockedOn } from "./logic";

// Guard: anything docked to the bottom of the screen outranks the install tip, which docks in the
// same spot. A bar the tip sits on can't be tapped, and a member can't tell a button is under it.
// So a new sticky or fixed bottom surface has three ways through here: report the surface busy
// while it is up (useReportSurfaceBusy, which the tip follows live), live only on a page the tip
// never shows on, or be listed below with why the tip can't cover it.

const SRC = join(__dirname, "..", "..");

// Can't be under the tip, with the reason why.
const NEVER_UNDER_THE_TIP: Record<string, string> = {
  "components/dashboard-layout/mobile-tab-bar.tsx":
    "the navigation: the tip docks just above it",
  "components/install-app/install-app-tip.tsx": "the tip itself",
  "components/ui/dialog.tsx": "a modal's footer: the modal covers the tip",
  "components/ui/sheet.tsx": "a modal sheet: it covers the tip",
  "components/admin/moderation/detail-actions.tsx":
    "below lg it opens in a Sheet (queue-list.tsx), and from md there is no tip",
  "components/blocks/cookie-consent.tsx": "z-50: it paints over the tip",
  "components/dashboard-layout/page-head.tsx":
    "sticks to the top; its bottom-0 is the edge line drawn on ::after",
  "components/marketing/footer.tsx":
    "a public page: the tip mounts in the dashboard shell only",
  "components/marketing/home/hero.tsx":
    "a public page: the tip mounts in the dashboard shell only",
  "components/tour/tour-layer.tsx":
    "a running tour reports the surface busy from tour-provider.tsx",
};

// Mounted only on a page installTipBlockedOn blocks, and a page there to prove it.
const ONLY_ON_BLOCKED_PAGES: Record<string, string> = {
  "components/quick-start/flow-view.tsx": "/welcome",
  "components/messaging/thread-view.tsx": "/messages/thread_1",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

// Without comments, so one that merely mentions a sticky bar doesn't count.
const codeOf = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");

// The class names in a file, without their variants: "max-sm:sticky" counts as "sticky". Per file,
// not per string: classes are often split over cn() arguments.
const classesOf = (code: string) =>
  (code.match(/"[^"\n]*"|`[^`]*`/g) ?? []).flatMap((literal) =>
    literal
      .slice(1, -1)
      .split(/\s+/)
      .map((name) => name.split(":").at(-1) ?? ""),
  );

const dockedSurfaces = sourceFiles(SRC).flatMap((path) => {
  const code = codeOf(path);
  const classes = classesOf(code);
  const docked =
    classes.some((name) => name === "sticky" || name === "fixed") &&
    classes.some((name) => name.startsWith("bottom-"));
  return docked ? [{ file: relative(SRC, path), code }] : [];
});

describe("bottom bars and the install tip", () => {
  it("finds the bars it guards", () => {
    expect(dockedSurfaces.map((surface) => surface.file)).toEqual(
      expect.arrayContaining([
        "components/library/bulk-action-bar.tsx",
        "components/household/my-household-copies.tsx",
        "components/solving/past-solves-form.tsx",
      ]),
    );
  });

  it("every bar reports the surface busy, or the tip can't reach it", () => {
    const uncovered = dockedSurfaces
      .filter(
        ({ file, code }) =>
          !code.includes("useReportSurfaceBusy(") &&
          !(file in NEVER_UNDER_THE_TIP) &&
          !(file in ONLY_ON_BLOCKED_PAGES),
      )
      .map(({ file }) => file);
    expect(uncovered).toEqual([]);
  });

  it("the pages it relies on are blocked for the tip", () => {
    for (const page of Object.values(ONLY_ON_BLOCKED_PAGES)) {
      expect(installTipBlockedOn(page), page).toBe(true);
    }
  });

  it("keeps no exception for a file that no longer docks anything", () => {
    const files = dockedSurfaces.map((surface) => surface.file);
    expect(
      [
        ...Object.keys(NEVER_UNDER_THE_TIP),
        ...Object.keys(ONLY_ON_BLOCKED_PAGES),
      ].filter((file) => !files.includes(file)),
    ).toEqual([]);
  });
});
