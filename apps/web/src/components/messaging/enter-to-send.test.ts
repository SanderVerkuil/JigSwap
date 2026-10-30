import { describe, expect, it } from "vitest";
import { shouldSendOnEnter, type EnterKeyEvent } from "./enter-to-send";

const key = (overrides: Partial<EnterKeyEvent> = {}): EnterKeyEvent => ({
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 13,
  ...overrides,
});

describe("shouldSendOnEnter", () => {
  it.each([
    // [case, event, coarse pointer, sends]
    ["plain Enter, mouse/trackpad", key(), false, true],
    ["plain Enter, touch screen", key(), true, false],
    ["Shift+Enter, mouse/trackpad", key({ shiftKey: true }), false, false],
    ["Alt+Enter, mouse/trackpad", key({ altKey: true }), false, false],
    ["Ctrl+Enter, mouse/trackpad", key({ ctrlKey: true }), false, true],
    ["Ctrl+Enter, touch screen", key({ ctrlKey: true }), true, true],
    ["Cmd+Enter, touch screen", key({ metaKey: true }), true, true],
    ["Ctrl+Shift+Enter", key({ ctrlKey: true, shiftKey: true }), false, false],
    ["Enter during IME", key({ isComposing: true }), false, false],
    [
      "Ctrl+Enter during IME",
      key({ isComposing: true, ctrlKey: true }),
      true,
      false,
    ],
    // Safari: the Enter that ends a composition arrives with isComposing
    // false and keyCode 229.
    ["Safari IME-confirm Enter", key({ keyCode: 229 }), false, false],
    ["another key", key({ key: "a", keyCode: 65 }), false, false],
  ] as const)("%s", (_case, event, coarse, sends) => {
    expect(shouldSendOnEnter(event, coarse)).toBe(sends);
  });
});
