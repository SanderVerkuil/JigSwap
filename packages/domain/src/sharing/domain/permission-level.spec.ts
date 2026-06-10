import { describe, expect, it } from "vitest";
import { canExchangeWithin, canManageMembers } from "./permission-level";

describe("canExchangeWithin", () => {
  it("denies ViewOnly but allows Exchange and Admin", () => {
    expect(canExchangeWithin("ViewOnly")).toBe(false);
    expect(canExchangeWithin("Exchange")).toBe(true);
    expect(canExchangeWithin("Admin")).toBe(true);
  });
});

describe("canManageMembers", () => {
  it("is Admin-only", () => {
    expect(canManageMembers("ViewOnly")).toBe(false);
    expect(canManageMembers("Exchange")).toBe(false);
    expect(canManageMembers("Admin")).toBe(true);
  });
});
