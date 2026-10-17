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
        new ConvexError({ code: "InviteeAlreadyInHousehold", message: "x" }),
      ),
    ).toBe("errors.InviteeAlreadyInHousehold");
  });

  it("falls back to the generic key for unknown codes and non-Convex errors", () => {
    expect(
      householdErrorKey(new ConvexError({ code: "Weird", message: "x" })),
    ).toBe("errors.generic");
    expect(householdErrorKey(new Error("boom"))).toBe("errors.generic");
  });
});
