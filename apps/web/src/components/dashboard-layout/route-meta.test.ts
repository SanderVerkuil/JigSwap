import { describe, expect, it } from "vitest";
import { isImmersiveMobileRoute } from "./route-meta";

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
