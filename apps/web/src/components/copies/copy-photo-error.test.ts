import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { copyPhotoErrorKey } from "./copy-photo-error";

describe("copyPhotoErrorKey", () => {
  it("says the member added too many photos for a RateLimited refusal", () => {
    expect(
      copyPhotoErrorKey(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      ),
    ).toBe("photoRateLimited");
  });

  it("says the copy is full for a TooManyImages refusal", () => {
    expect(
      copyPhotoErrorKey(
        new ConvexError({
          code: "TooManyImages",
          message: "A copy can have at most 20 photos",
        }),
      ),
    ).toBe("photoLimitReached");
  });

  it.each([
    ["a failed upload", new Error("upload failed")],
    ["a message-only refusal", new ConvexError("File not found")],
    ["another code", new ConvexError({ code: "NotOwner" })],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(copyPhotoErrorKey(error)).toBe("photoFailed");
  });

  it("every key it returns exists in English and Dutch", () => {
    for (const key of [
      "photoRateLimited",
      "photoLimitReached",
      "photoFailed",
    ] as const) {
      expect(en.copyInstance[key]).toBeTruthy();
      expect(nl.copyInstance[key]).toBeTruthy();
    }
  });
});
