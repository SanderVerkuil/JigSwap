import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  canManageHouseholdCopy,
  DEFAULT_HOUSEHOLD_COPY_PERMISSION,
  householdCopyAccess,
  resolveHouseholdCopyPermission,
} from "./copy-access";

const owner = toMemberId("owner");
const mate = toMemberId("mate");

describe("resolveHouseholdCopyPermission", () => {
  it("treats an absent stored permission as the default (manage)", () => {
    expect(DEFAULT_HOUSEHOLD_COPY_PERMISSION).toBe("manage");
    expect(resolveHouseholdCopyPermission(undefined)).toBe("manage");
  });

  it("keeps an explicit permission", () => {
    expect(resolveHouseholdCopyPermission("view")).toBe("view");
    expect(resolveHouseholdCopyPermission("manage")).toBe("manage");
  });
});

describe("householdCopyAccess", () => {
  it("is owner for the copy's owner regardless of household", () => {
    expect(householdCopyAccess({ ownerId: owner }, owner, false)).toBe("owner");
  });

  it("is none for a member outside the owner's household", () => {
    expect(householdCopyAccess({ ownerId: owner }, mate, false)).toBe("none");
  });

  it("gives a household mate the copy's permission, defaulting to manage", () => {
    expect(householdCopyAccess({ ownerId: owner }, mate, true)).toBe("manage");
    expect(
      householdCopyAccess(
        { ownerId: owner, householdPermission: "view" },
        mate,
        true,
      ),
    ).toBe("view");
  });
});

describe("canManageHouseholdCopy", () => {
  it("allows owner and manage, denies view and none", () => {
    expect(canManageHouseholdCopy("owner")).toBe(true);
    expect(canManageHouseholdCopy("manage")).toBe(true);
    expect(canManageHouseholdCopy("view")).toBe(false);
    expect(canManageHouseholdCopy("none")).toBe(false);
  });
});
