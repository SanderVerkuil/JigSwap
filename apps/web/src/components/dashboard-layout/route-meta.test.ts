import { describe, expect, it } from "vitest";
import {
  getNavGroup,
  hasOwnAddAction,
  isFullBleedRoute,
  isImmersiveMobileRoute,
  isMobileTabRoot,
  MOBILE_TABS,
} from "./route-meta";

describe("isImmersiveMobileRoute", () => {
  it.each(["/messages/seed-thread-esther", "/messages/new", "/messages/abc/"])(
    "is immersive on %s",
    (pathname) => {
      expect(isImmersiveMobileRoute(pathname)).toBe(true);
    },
  );

  it.each(["/messages", "/messages/", "/dashboard", "/trades", "/messagesx/1"])(
    "is not immersive on %s",
    (pathname) => {
      expect(isImmersiveMobileRoute(pathname)).toBe(false);
    },
  );
});

describe("isFullBleedRoute", () => {
  it.each([
    "/messages",
    "/messages/",
    "/messages/seed-thread-esther",
    "/messages/new",
  ])("is full-bleed on %s", (pathname) => {
    expect(isFullBleedRoute(pathname)).toBe(true);
  });

  it.each(["/dashboard", "/trades", "/messagesx", "/circles/messages"])(
    "is not full-bleed on %s",
    (pathname) => {
      expect(isFullBleedRoute(pathname)).toBe(false);
    },
  );
});

// UX-59: the phone tabs open these pages, so the top bar shows no back chevron there.
describe("isMobileTabRoot", () => {
  it.each(["/dashboard", "/library", "/trades", "/community", "/trades/"])(
    "is a tab root on %s",
    (pathname) => {
      expect(isMobileTabRoot(pathname)).toBe(true);
    },
  );

  it("treats every tab's destination as a tab root", () => {
    expect(MOBILE_TABS.map((tab) => tab.href)).toEqual([
      "/dashboard",
      "/library",
      "/trades",
      "/community",
    ]);
    for (const tab of MOBILE_TABS) {
      expect(isMobileTabRoot(tab.href)).toBe(true);
    }
  });

  it.each(["/my-puzzles", "/messages", "/circles", "/trades/abc", "/browse"])(
    "is not a tab root on %s",
    (pathname) => {
      expect(isMobileTabRoot(pathname)).toBe(false);
    },
  );
});

// UX-06: the Community tab and hub use the group icon, so Circles needs a glyph of its own.
describe("nav icons", () => {
  it("gives Circles an icon distinct from the Community group's", () => {
    const community = getNavGroup("community");
    const circles = community.items.find((item) => item.key === "circles");
    expect(circles?.icon).toBeDefined();
    expect(circles?.icon).not.toBe(community.icon);
  });
});

describe("hasOwnAddAction", () => {
  it.each([
    "/my-puzzles",
    "/my-puzzles/",
    "/my-puzzles/add",
    "/my-puzzles/add/new",
    "/my-puzzles/m572kmqqpcd0c4a106ve41fz318ge4xr",
    "/puzzles",
    "/puzzles/add",
    "/puzzles/m9712xm5gtgnqszgq5xwvh82ph8a9hdz",
  ])("has its own add action on %s", (pathname) => {
    expect(hasOwnAddAction(pathname)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/browse",
    "/household",
    "/collections/abc/add-puzzles",
    "/my-puzzlesx",
    "/puzzlesx",
  ])("leaves the top bar's add action on %s", (pathname) => {
    expect(hasOwnAddAction(pathname)).toBe(false);
  });
});
