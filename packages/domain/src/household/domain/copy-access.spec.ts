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
  it("falls back to manage when neither the copy nor the household sets one", () => {
    expect(DEFAULT_HOUSEHOLD_COPY_PERMISSION).toBe("manage");
    expect(resolveHouseholdCopyPermission(undefined)).toBe("manage");
    expect(resolveHouseholdCopyPermission(undefined, undefined)).toBe("manage");
  });

  it("uses the household default when the copy has no explicit value", () => {
    expect(resolveHouseholdCopyPermission(undefined, "view")).toBe("view");
    expect(resolveHouseholdCopyPermission(undefined, "manage")).toBe("manage");
  });

  it("lets an explicit copy value win over the household default", () => {
    expect(resolveHouseholdCopyPermission("view")).toBe("view");
    expect(resolveHouseholdCopyPermission("manage", "view")).toBe("manage");
    expect(resolveHouseholdCopyPermission("view", "manage")).toBe("view");
  });
});

describe("householdCopyAccess", () => {
  it("is owner for the copy's owner regardless of household", () => {
    expect(householdCopyAccess({ ownerId: owner }, owner, null)).toBe("owner");
    expect(
      householdCopyAccess({ ownerId: owner }, owner, {
        defaultCopyPermission: "view",
      }),
    ).toBe("owner");
  });

  it("is none for a member outside the owner's household", () => {
    expect(householdCopyAccess({ ownerId: owner }, mate, null)).toBe("none");
  });

  it("gives a household mate the copy's permission, else the household default, else manage", () => {
    expect(householdCopyAccess({ ownerId: owner }, mate, {})).toBe("manage");
    expect(
      householdCopyAccess({ ownerId: owner }, mate, {
        defaultCopyPermission: "view",
      }),
    ).toBe("view");
    expect(
      householdCopyAccess(
        { ownerId: owner, householdPermission: "manage" },
        mate,
        { defaultCopyPermission: "view" },
      ),
    ).toBe("manage");
    expect(
      householdCopyAccess(
        { ownerId: owner, householdPermission: "view" },
        mate,
        {},
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
