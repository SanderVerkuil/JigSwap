import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok } from "./result";

describe("Result", () => {
  it("constructs an ok result carrying its value", () => {
    const result = ok(42);
    expect(result.isOk).toBe(true);
    expect(result.isErr).toBe(false);
    expect(result.value).toBe(42);
  });

  it("constructs an err result carrying its error", () => {
    const result = err("boom");
    expect(result.isOk).toBe(false);
    expect(result.isErr).toBe(true);
    expect(result.error).toBe("boom");
  });

  it("narrows with the isOk discriminant", () => {
    const result = ok("value");
    if (isOk(result)) {
      expect(result.value).toBe("value");
    } else {
      throw new Error("expected ok");
    }
  });

  it("narrows with the isErr discriminant", () => {
    const result = err(new Error("nope"));
    if (isErr(result)) {
      expect(result.error.message).toBe("nope");
    } else {
      throw new Error("expected err");
    }
  });
});
