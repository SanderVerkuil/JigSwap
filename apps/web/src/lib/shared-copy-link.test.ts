import { describe, expect, it } from "vitest";
import { isSharedCopyHref, sharedCopyUrl } from "./shared-copy-link";

describe("sharedCopyUrl", () => {
  it("points at the copy page, flagged as a sent link", () => {
    expect(sharedCopyUrl("https://jigswap.site", "abc")).toBe(
      "https://jigswap.site/copies/abc?shared=1",
    );
  });
});

describe("isSharedCopyHref", () => {
  it.each([
    "/copies/abc?shared=1",
    "/copies/abc/?shared=1",
    "/copies/abc?from=x&shared=1",
    "https://jigswap.site/copies/abc?shared=1",
  ])("recognises %s", (href) => {
    expect(isSharedCopyHref(href)).toBe(true);
  });

  it.each([
    "/copies/abc",
    "/copies/abc?shared=0",
    "/my-puzzles/abc?shared=1",
    "/copies/abc/edit?shared=1",
    "/copies?shared=1",
    undefined,
    42,
  ])("doesn't treat %s as one", (href) => {
    expect(isSharedCopyHref(href)).toBe(false);
  });
});
