import { describe, expect, it } from "vitest";
import { toId, toMemberId } from "../../shared-kernel";
import { Household } from "./household";
import { HouseholdId } from "./ids";

const id = toId<"HouseholdId">("household-1") as HouseholdId;
const ann = toMemberId("ann");
const bob = toMemberId("bob");
const cat = toMemberId("cat");
const t0 = new Date("2026-10-01T00:00:00Z");
const t1 = new Date("2026-10-02T00:00:00Z");
const t2 = new Date("2026-10-03T00:00:00Z");

const founded = (): Household => {
  const h = Household.found({ id, founderId: ann, now: t0 });
  h.pullEvents();
  return h;
};

describe("Household.found", () => {
  it("makes the founder the sole admin and records HouseholdFounded", () => {
    const h = Household.found({ id, founderId: ann, now: t0 });
    expect(h.members).toEqual([{ memberId: ann, role: "admin", joinedAt: t0 }]);
    expect(h.isAdmin(ann)).toBe(true);
    expect(h.pullEvents().map((e) => e.name)).toEqual(["HouseholdFounded"]);
  });
});

describe("Household.admit", () => {
  it("adds a plain member and records HouseholdMemberJoined", () => {
    const h = founded();
    expect(h.admit(bob, t1).isOk).toBe(true);
    expect(h.isMember(bob)).toBe(true);
    expect(h.isAdmin(bob)).toBe(false);
    expect(h.members).toContainEqual({
      memberId: bob,
      role: "member",
      joinedAt: t1,
    });
    expect(h.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdMemberJoined",
    ]);
  });

  it("rejects admitting an existing member", () => {
    const h = founded();
    const result = h.admit(ann, t1);
    expect(result.isErr && result.error.code).toBe("AlreadyMember");
  });
});

describe("Household.leave", () => {
  it("rejects a non-member", () => {
    const result = founded().leave(bob, t1);
    expect(result.isErr && result.error.code).toBe("NotAMember");
  });

  it("removes a plain member without dissolving", () => {
    const h = founded();
    h.admit(bob, t1);
    h.pullEvents();
    const result = h.leave(bob, t2);
    expect(result.isOk && result.value).toEqual({ dissolved: false });
    expect(h.isMember(bob)).toBe(false);
    expect(h.pullEvents().map((e) => e.name)).toEqual(["HouseholdMemberLeft"]);
  });

  it("promotes the longest-standing remaining member when the admin leaves", () => {
    const h = founded();
    h.admit(cat, t2);
    h.admit(bob, t1);
    expect(h.leave(ann, t2).isOk).toBe(true);
    expect(h.isAdmin(bob)).toBe(true);
    expect(h.isAdmin(cat)).toBe(false);
  });

  it("keeps the admin and promotes no one when a plain member leaves", () => {
    // The admin is not the longest-standing member, so a needless promotion would be visible.
    const h = Household.rehydrate({
      id,
      members: [
        { memberId: bob, role: "member", joinedAt: t0 },
        { memberId: ann, role: "admin", joinedAt: t1 },
        { memberId: cat, role: "member", joinedAt: t2 },
      ],
      createdAt: t0,
    });
    expect(h.leave(cat, t2).isOk).toBe(true);
    expect(h.members).toEqual([
      { memberId: bob, role: "member", joinedAt: t0 },
      { memberId: ann, role: "admin", joinedAt: t1 },
    ]);
  });

  it("promotes the senior member even when they are not listed last", () => {
    const h = founded();
    h.admit(bob, t1);
    h.admit(cat, t2);
    expect(h.leave(ann, t2).isOk).toBe(true);
    expect(h.isAdmin(bob)).toBe(true);
    expect(h.isAdmin(cat)).toBe(false);
  });

  it("promotes the earlier-listed member when join times tie", () => {
    const h = founded();
    h.admit(bob, t1);
    h.admit(cat, t1);
    expect(h.leave(ann, t2).isOk).toBe(true);
    expect(h.isAdmin(bob)).toBe(true);
    expect(h.isAdmin(cat)).toBe(false);
  });

  it("dissolves when the last member leaves", () => {
    const h = founded();
    const result = h.leave(ann, t1);
    expect(result.isOk && result.value).toEqual({ dissolved: true });
    expect(h.members).toEqual([]);
    expect(h.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdMemberLeft",
      "HouseholdDissolved",
    ]);
  });
});

describe("Household.remove", () => {
  it("lets the admin remove another member", () => {
    const h = founded();
    h.admit(bob, t1);
    h.pullEvents();
    expect(h.remove(ann, bob, t2).isOk).toBe(true);
    expect(h.isMember(bob)).toBe(false);
    expect(h.pullEvents().map((e) => e.name)).toEqual([
      "HouseholdMemberRemoved",
    ]);
  });

  it("rejects a non-admin remover", () => {
    const h = founded();
    h.admit(bob, t1);
    h.admit(cat, t1);
    const result = h.remove(bob, cat, t2);
    expect(result.isErr && result.error.code).toBe("NotHouseholdAdmin");
  });

  it("rejects the admin removing themselves (they leave instead)", () => {
    const result = founded().remove(ann, ann, t1);
    expect(result.isErr && result.error.code).toBe("CannotRemoveSelf");
  });

  it("rejects removing a non-member", () => {
    const result = founded().remove(ann, bob, t1);
    expect(result.isErr && result.error.code).toBe("NotAMember");
  });
});
