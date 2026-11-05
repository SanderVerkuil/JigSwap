import { describe, expect, it, vi } from "vitest";

// getIntl's payload rides in the root beforeLoad context, which Start dehydrates into every
// document. It must stay tiny: the message catalog travels as a cached asset instead
// (lib/i18n-catalog.ts). Runs the real handler through a minimal createServerFn stand-in.
vi.mock("@tanstack/react-start", () => {
  const builder = {
    validator: () => builder,
    handler:
      <T>(fn: (input: { data?: unknown }) => T) =>
      (input: { data?: unknown } = {}) =>
        fn(input),
  };
  return { createServerFn: () => builder };
});

vi.mock("./i18n.server", () => ({
  detectLocale: () => "nl",
  loadMessages: async () => ({ titles: { home: "Start" } }),
  writeLocaleCookie: () => {},
}));

const { getIntl } = await import("./i18n");

describe("getIntl", () => {
  it("returns the locale, time zone and clock only, never messages", async () => {
    const payload = await getIntl();
    expect(Object.keys(payload).sort()).toEqual(["locale", "now", "timeZone"]);
    expect(payload.locale).toBe("nl");
    expect(JSON.stringify(payload).length).toBeLessThan(100);
  });
});
