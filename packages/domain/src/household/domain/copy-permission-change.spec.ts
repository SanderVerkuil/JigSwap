import { describe, expect, it } from "vitest";
import { toMemberId } from "../../shared-kernel";
import {
  dedupeHouseholdPermissionBatch,
  householdPermissionChange,
  MAX_HOUSEHOLD_PERMISSION_BATCH,
  planHouseholdPermissionBatch,
} from "./copy-permission-change";
import { HouseholdError } from "./errors";

const owner = toMemberId("owner");
const mate = toMemberId("mate");

describe("householdPermissionChange", () => {
  it("rejects anyone but the copy's owner", () => {
    const result = householdPermissionChange({ ownerId: owner }, mate, "view");
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error).toBeInstanceOf(HouseholdError);
      expect(result.error.code).toBe("NotCopyOwner");
    }
  });

  it("needs a write only when the stored explicit value differs from the choice", () => {
    const write =
      (stored: "manage" | "view" | undefined) =>
      (choice: "manage" | "view" | "default") =>
        householdPermissionChange(
          { ownerId: owner, householdPermission: stored },
          owner,
          choice,
        );
    const yes = { isOk: true, isErr: false, value: true };
    const no = { isOk: true, isErr: false, value: false };
    // An explicit choice pins the copy even when it equals what it inherits today.
    expect(write(undefined)("manage")).toEqual(yes);
    expect(write(undefined)("view")).toEqual(yes);
    expect(write(undefined)("default")).toEqual(no);
    expect(write("view")("view")).toEqual(no);
    expect(write("view")("manage")).toEqual(yes);
    expect(write("view")("default")).toEqual(yes);
    expect(write("manage")("manage")).toEqual(no);
    expect(write("manage")("default")).toEqual(yes);
  });
});

describe("dedupeHouseholdPermissionBatch", () => {
  it("drops duplicate ids, keeping first-seen order", () => {
    expect(dedupeHouseholdPermissionBatch(["a", "b", "a", "c", "b"])).toEqual({
      isOk: true,
      isErr: false,
      value: ["a", "b", "c"],
    });
  });

  it("accepts exactly the cap, counted after deduplication", () => {
    expect(MAX_HOUSEHOLD_PERMISSION_BATCH).toBe(200);
    const ids = Array.from({ length: 200 }, (_, i) => `c${i}`);
    const result = dedupeHouseholdPermissionBatch([...ids, ...ids]);
    expect(result.isOk && result.value.length).toBe(200);
  });

  it("rejects more distinct ids than the cap", () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const result = dedupeHouseholdPermissionBatch(ids);
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe("PermissionBatchTooLarge");
      expect(result.error.message).toContain("200");
    }
  });
});

describe("planHouseholdPermissionBatch", () => {
  const a = { id: "a", ownerId: owner };
  const b = { id: "b", ownerId: owner, householdPermission: "view" as const };
  const c = { id: "c", ownerId: owner, householdPermission: "manage" as const };

  it("splits the batch into copies to write and copies already at the target", () => {
    const result = planHouseholdPermissionBatch([a, b, c], owner, "view");
    expect(result).toEqual({
      isOk: true,
      isErr: false,
      value: { toChange: [a, c], unchanged: 1 },
    });
  });

  it("clears explicit values for the default choice and leaves inheriting copies alone", () => {
    const result = planHouseholdPermissionBatch([a, b, c], owner, "default");
    expect(result).toEqual({
      isOk: true,
      isErr: false,
      value: { toChange: [b, c], unchanged: 1 },
    });
  });

  it("reports nothing to change on an idempotent re-run", () => {
    const result = planHouseholdPermissionBatch([b], owner, "view");
    expect(result).toEqual({
      isOk: true,
      isErr: false,
      value: { toChange: [], unchanged: 1 },
    });
  });

  it("rejects the whole batch when any copy belongs to someone else", () => {
    const foreign = { id: "x", ownerId: mate };
    const result = planHouseholdPermissionBatch([a, foreign, c], owner, "view");
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotCopyOwner");
  });
});
