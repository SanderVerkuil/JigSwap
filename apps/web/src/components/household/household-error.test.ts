import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { householdErrorKey } from "./household-error";

describe("householdErrorKey", () => {
  it("maps known household codes to their message key", () => {
    expect(
      householdErrorKey(
        new ConvexError({ code: "AlreadyInHousehold", message: "x" }),
      ),
    ).toBe("errors.AlreadyInHousehold");
    expect(
      householdErrorKey(
        new ConvexError({ code: "AlreadyMember", message: "x" }),
      ),
    ).toBe("errors.AlreadyMember");
    expect(
      householdErrorKey(
        new ConvexError({ code: "PermissionBatchTooLarge", message: "x" }),
      ),
    ).toBe("errors.PermissionBatchTooLarge");
  });

  it("falls back to the generic key for unknown codes and non-Convex errors", () => {
    expect(
      householdErrorKey(new ConvexError({ code: "Weird", message: "x" })),
    ).toBe("errors.generic");
    expect(householdErrorKey(new Error("boom"))).toBe("errors.generic");
  });
});

describe("householdErrorKey with JSON-encoded refusal data", () => {
  it("reads the code like the shared helper does", () => {
    expect(
      householdErrorKey(
        new ConvexError(JSON.stringify({ code: "AlreadyMember" })),
      ),
    ).toBe("errors.AlreadyMember");
  });
});
