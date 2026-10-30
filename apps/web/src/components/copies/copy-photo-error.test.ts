import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { copyPhotoError } from "./copy-photo-error";

const NOW = 1_000_000;

describe("copyPhotoError", () => {
  it("says the member reached the photo limit, and when they can try again", () => {
    expect(
      copyPhotoError(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
        NOW,
      ),
    ).toEqual({ key: "photoRateLimited", retryAt: NOW + 60_000 });
  });

  it("says the copy is full for a TooManyImages refusal", () => {
    expect(
      copyPhotoError(
        new ConvexError({
          code: "TooManyImages",
          message: "A copy can have at most 20 photos",
        }),
        NOW,
      ),
    ).toEqual({ key: "photoLimitReached" });
  });

  it.each([
    ["a failed upload", new Error("upload failed")],
    ["a message-only refusal", new ConvexError("File not found")],
    ["another code", new ConvexError({ code: "NotOwner" })],
    [
      "a RateLimited refusal without a wait",
      new ConvexError({ code: "RateLimited" }),
    ],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(copyPhotoError(error, NOW)).toEqual({ key: "photoFailed" });
  });

  it("every key it returns exists in English and Dutch, with its placeholders", () => {
    for (const key of [
      "photoRateLimited",
      "photoLimitReached",
      "photoFailed",
    ] as const) {
      expect(en.copyInstance[key]).toBeTruthy();
      expect(nl.copyInstance[key]).toBeTruthy();
    }
    expect(en.copyInstance.photoRateLimited).toContain("{when}");
    expect(nl.copyInstance.photoRateLimited).toContain("{when}");
    expect(en.copyInstance.photoLimitReached).toContain("{max}");
    expect(nl.copyInstance.photoLimitReached).toContain("{max}");
  });
});
