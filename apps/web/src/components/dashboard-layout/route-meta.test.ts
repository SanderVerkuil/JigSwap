import { describe, expect, it } from "vitest";
import { isFullBleedRoute, isImmersiveMobileRoute } from "./route-meta";

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
