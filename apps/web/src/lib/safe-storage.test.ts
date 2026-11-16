// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "./safe-storage";

const blocked = () => {
  throw new DOMException("blocked", "SecurityError");
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("safeStorage", () => {
  it("reads, writes and removes when storage works", () => {
    safeStorage.setItem("session", "k", "v");
    expect(safeStorage.getItem("session", "k")).toBe("v");
    safeStorage.removeItem("session", "k");
    expect(safeStorage.getItem("session", "k")).toBeNull();
  });

  // Safari and in-app browsers can throw from the property read itself.
  it("reads null and drops writes when the storage property throws", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(blocked);
    expect(safeStorage.getItem("session", "k")).toBeNull();
    expect(() => safeStorage.setItem("session", "k", "v")).not.toThrow();
    expect(() => safeStorage.removeItem("session", "k")).not.toThrow();
  });

  // A full quota or blocked storage throws from the method call instead.
  it("reads null and drops writes when a Storage method throws", () => {
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue({
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    } as unknown as Storage);
    expect(safeStorage.getItem("session", "k")).toBeNull();
    expect(() => safeStorage.setItem("session", "k", "v")).not.toThrow();
    expect(() => safeStorage.removeItem("session", "k")).not.toThrow();
  });
});
