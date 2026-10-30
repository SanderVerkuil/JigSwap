import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { contributeErrorKey } from "./contribute-error";

describe("contributeErrorKey", () => {
  it("says the member added a lot just now for a RateLimited refusal", () => {
    expect(
      contributeErrorKey(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      ),
    ).toBe("rateLimited");
  });

  it("says a field is too long for a TextTooLong refusal", () => {
    expect(
      contributeErrorKey(
        new ConvexError({
          code: "TextTooLong",
          message: "The title can be at most 200 characters",
        }),
      ),
    ).toBe("textTooLong");
  });

  it.each([
    ["a failed upload", new Error("Image upload failed")],
    ["a message-only refusal", new ConvexError("Unauthenticated")],
    ["another code", new ConvexError({ code: "DuplicateBarcode" })],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(contributeErrorKey(error)).toBe("puzzleCreationFailed");
  });

  it("every key it returns exists in English, Dutch and the source catalogue", () => {
    for (const key of [
      "rateLimited",
      "textTooLong",
      "puzzleCreationFailed",
    ] as const) {
      expect(en.puzzles[key]).toBeTruthy();
      expect(nl.puzzles[key]).toBeTruthy();
      expect(source.puzzles[key]).toBe(en.puzzles[key]);
    }
  });
});
