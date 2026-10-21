import { describe, expect, it } from "vitest";
import { parseVersion, STALE_BUILD, versionToPrompt } from "./app-version";

describe("versionToPrompt", () => {
  it("stays quiet while the deployed version is the one loaded", () => {
    expect(versionToPrompt("a", null, "a")).toBeNull();
  });

  it("stays quiet when the check failed", () => {
    expect(versionToPrompt("a", null, null)).toBeNull();
  });

  it("prompts for a newer deployed version", () => {
    expect(versionToPrompt("a", null, "b")).toBe("b");
  });

  it("prompts only once for the same version", () => {
    expect(versionToPrompt("a", "b", "b")).toBeNull();
  });

  it("prompts again when yet another version is deployed", () => {
    expect(versionToPrompt("a", "b", "c")).toBe("c");
  });

  it("prompts on a chunk-load failure when nothing was prompted yet", () => {
    expect(versionToPrompt("a", null, STALE_BUILD)).toBe(STALE_BUILD);
  });

  it("doesn't prompt for a chunk-load failure after a version prompt", () => {
    expect(versionToPrompt("a", "b", STALE_BUILD)).toBeNull();
  });

  it("doesn't prompt for a version found after a chunk-load prompt", () => {
    expect(versionToPrompt("a", STALE_BUILD, "b")).toBeNull();
  });
});

describe("parseVersion", () => {
  it("reads the version field", () => {
    expect(parseVersion({ version: "abc123" })).toBe("abc123");
  });

  it.each([null, "abc", {}, { version: "" }, { version: 42 }])(
    "rejects %j",
    (body) => {
      expect(parseVersion(body)).toBeNull();
    },
  );
});
