import { UploadRateLimitedError } from "@/lib/upload-rate-limit";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  contributeError,
  CopyStepError,
  coverStep,
  CoverStepError,
} from "./contribute-error";

const NOW = 1_000_000;
const limited = () =>
  new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 });

describe("contributeError", () => {
  it("names the submission limit, and when to try again, for a refused submission", () => {
    expect(contributeError(limited(), NOW)).toEqual({
      key: "rateLimited",
      retryAt: NOW + 60_000,
    });
  });

  it("names the cover-photo limit when the cover step was refused", () => {
    expect(contributeError(new CoverStepError(limited()), NOW)).toEqual({
      key: "coverRateLimited",
      retryAt: NOW + 60_000,
    });
  });

  it("names the daily copy budget when the copy step was refused", () => {
    expect(contributeError(new CopyStepError(limited()), NOW)).toEqual({
      key: "addRateLimited",
    });
    expect(
      contributeError(
        new CopyStepError(new ConvexError({ code: "RateLimited" })),
        NOW,
      ),
    ).toEqual({ key: "addRateLimited" });
  });

  it("says a field is too long for a TextTooLong refusal", () => {
    expect(
      contributeError(
        new ConvexError({
          code: "TextTooLong",
          message: "The title can be at most 200 characters",
        }),
        NOW,
      ),
    ).toEqual({ key: "textTooLong" });
  });

  it("says the width or height is wrong for an InvalidDimensions refusal", () => {
    expect(
      contributeError(
        new ConvexError({
          code: "InvalidDimensions",
          message: "A puzzle's width and height must be positive numbers",
        }),
        NOW,
      ),
    ).toEqual({ key: "invalidDimensions" });
  });

  // An imported EAN or UPC the member never looked at used to end in "Failed to create puzzle".
  it("says a barcode is wrong for an InvalidBarcode refusal", () => {
    expect(
      contributeError(
        new ConvexError({
          code: "InvalidBarcode",
          message: "Invalid EAN: check digit does not match",
        }),
        NOW,
      ),
    ).toEqual({ key: "invalidBarcode" });
  });

  it.each([
    ["a failed upload", new Error("Image upload failed")],
    ["a failed cover step", new CoverStepError(new Error("upload failed"))],
    ["a failed copy step", new CopyStepError(new Error("network down"))],
    ["a message-only refusal", new ConvexError("Unauthenticated")],
    ["another code", new ConvexError({ code: "DuplicateBarcode" })],
    [
      "a RateLimited refusal without a wait",
      new ConvexError({ code: "RateLimited" }),
    ],
  ])("keeps the generic message for %s", (_label, error) => {
    expect(contributeError(error, NOW)).toEqual({
      key: "puzzleCreationFailed",
    });
  });

  it("every key it returns exists in English, Dutch and the source catalogue", () => {
    for (const key of [
      "rateLimited",
      "coverRateLimited",
      "addRateLimited",
      "textTooLong",
      "invalidBarcode",
      "puzzleCreationFailed",
    ] as const) {
      expect(en.puzzles[key]).toBeTruthy();
      expect(nl.puzzles[key]).toBeTruthy();
      expect(source.puzzles[key]).toBe(en.puzzles[key]);
    }
    for (const key of ["rateLimited", "coverRateLimited"] as const) {
      expect(en.puzzles[key]).toContain("{when}");
      expect(nl.puzzles[key]).toContain("{when}");
    }
  });

  it("offers a way on that the form still has: no photo, not a cover colour", () => {
    expect(en.puzzles.coverRateLimited).toContain("without a photo");
    expect(en.puzzles.coverRateLimited).not.toMatch(/colour/i);
    expect(nl.puzzles.coverRateLimited).toContain("zonder foto");
    expect(nl.puzzles.coverRateLimited).not.toMatch(/kleur/i);
  });
});

describe("coverStep", () => {
  it("passes the step's result through", async () => {
    await expect(coverStep(async () => "storage-id")).resolves.toBe(
      "storage-id",
    );
  });

  it("tags the step's failure as a CoverStepError carrying the original", async () => {
    const refusal = limited();
    const failure = await coverStep(async () => {
      throw refusal;
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CoverStepError);
    expect((failure as CoverStepError).original).toBe(refusal);
  });

  it("leaves the upload limit's refused URL untagged, so it keeps the upload message", async () => {
    const refusal = new UploadRateLimitedError(limited());
    const failure = await coverStep(async () => {
      throw refusal;
    }).catch((error: unknown) => error);
    expect(failure).toBe(refusal);
  });
});
