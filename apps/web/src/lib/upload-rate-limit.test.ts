import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { isRateLimited } from "./upload-rate-limit";

describe("isRateLimited", () => {
  it("is true for the server's RateLimited refusal", () => {
    expect(
      isRateLimited(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      ),
    ).toBe(true);
  });

  it.each([
    ["another code", new ConvexError({ code: "InvalidUpload" })],
    ["a string ConvexError", new ConvexError("RateLimited")],
    ["a plain error", new Error("RateLimited")],
    ["nothing", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isRateLimited(error)).toBe(false);
  });
});
