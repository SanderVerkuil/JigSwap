import { describe, expect, it } from "vitest";
import { shortcutHint } from "./shortcut-hint";

describe("shortcutHint", () => {
  it("shows the Command key on Apple platforms", () => {
    for (const platform of ["MacIntel", "macOS", "iPhone", "iPad", "iPod"]) {
      expect(shortcutHint(platform)).toBe("⌘K");
    }
  });

  it("shows Ctrl everywhere else", () => {
    for (const platform of [
      "Win32",
      "Windows",
      "Linux x86_64",
      "Linux armv8l",
      "Android",
      "Chrome OS",
      "",
    ]) {
      expect(shortcutHint(platform)).toBe("Ctrl K");
    }
  });
});
