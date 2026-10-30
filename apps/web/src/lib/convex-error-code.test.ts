import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { convexErrorCode, convexRetryAfterMs } from "./convex-error-code";

describe("convexErrorCode", () => {
  it("reads the code of a structured refusal", () => {
    expect(convexErrorCode(new ConvexError({ code: "RateLimited" }))).toBe(
      "RateLimited",
    );
  });

  // The data can arrive JSON-encoded (exchange/request-trade relied on this before it shared
  // this helper).
  it("reads the code of a JSON-encoded refusal", () => {
    expect(
      convexErrorCode(
        new ConvexError(JSON.stringify({ code: "DuplicateProposal" })),
      ),
    ).toBe("DuplicateProposal");
  });

  it.each([
    ["a plain error", new Error("RateLimited")],
    ["a message-only ConvexError", new ConvexError("RateLimited")],
    ["a ConvexError without a code", new ConvexError({ reason: "x" })],
    ["a non-string code", new ConvexError({ code: 429 })],
    ["a non-error value", { code: "RateLimited" }],
  ])("is undefined for %s", (_label, error) => {
    expect(convexErrorCode(error)).toBeUndefined();
  });
});

describe("convexRetryAfterMs", () => {
  it("reads how long the refusal asks the caller to wait", () => {
    expect(
      convexRetryAfterMs(
        new ConvexError({ code: "RateLimited", retryAfterMs: 90_000 }),
      ),
    ).toBe(90_000);
  });

  it("reads the wait of a JSON-encoded refusal", () => {
    expect(
      convexRetryAfterMs(
        new ConvexError(
          JSON.stringify({ code: "RateLimited", retryAfterMs: 60_000 }),
        ),
      ),
    ).toBe(60_000);
  });

  it.each([
    ["no wait", new ConvexError({ code: "RateLimited" })],
    ["a non-numeric wait", new ConvexError({ retryAfterMs: "soon" })],
    ["a plain error", new Error("RateLimited")],
  ])("is undefined for %s", (_label, error) => {
    expect(convexRetryAfterMs(error)).toBeUndefined();
  });
});
