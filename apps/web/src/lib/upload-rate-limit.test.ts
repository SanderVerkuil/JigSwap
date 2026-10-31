import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { isUploadRateLimited, mintUploadUrl } from "./upload-rate-limit";

describe("mintUploadUrl", () => {
  it("resolves with the minted upload URL", async () => {
    await expect(
      mintUploadUrl(async () => "https://upload.test"),
    ).resolves.toBe("https://upload.test");
  });

  it("turns the server's RateLimited refusal into an upload rate-limit error", async () => {
    const refusal = new ConvexError({
      code: "RateLimited",
      retryAfterMs: 60_000,
    });
    const error = await mintUploadUrl(async () => {
      throw refusal;
    }).catch((e: unknown) => e);

    expect(isUploadRateLimited(error)).toBe(true);
    expect((error as Error).cause).toBe(refusal);
  });

  it.each([
    ["another code", new ConvexError({ code: "InvalidUpload" })],
    ["a string ConvexError", new ConvexError("RateLimited")],
    ["a plain error", new Error("RateLimited")],
  ])("passes %s through unchanged", async (_label, refusal) => {
    const error = await mintUploadUrl(async () => {
      throw refusal;
    }).catch((e: unknown) => e);

    expect(error).toBe(refusal);
    expect(isUploadRateLimited(error)).toBe(false);
  });
});

describe("isUploadRateLimited", () => {
  // A RateLimited refusal from any later step (an attach, a catalogue submit, a proposal) is not
  // the upload limit: only an error that came through mintUploadUrl is.
  it.each([
    [
      "a RateLimited refusal from another step",
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    ],
    ["a plain error", new Error("upload failed")],
    ["nothing", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isUploadRateLimited(error)).toBe(false);
  });
});
