import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// The copy page shows its owner. getCopyInstanceView carries the owner as a projected identity
// (projectMemberIdentity, salt = copyId): revealed for a public owner or a mutual follower,
// anonymised otherwise, and never with an email. A household mate additionally gets the owner's
// household person view (name/avatar, the same view behind the "Household · {owner}" badge).

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

const seed = (t: T, copyExtra: Record<string, unknown> = {}) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
    const mkUser = (who: string, name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name,
        username: who,
        avatar: `https://avatars/${who}.png`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const owner = await mkUser("owner", "Olivia Owner");
    const viewer = await mkUser("viewer", "Victor Viewer");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-owned",
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
      ...copyExtra,
    });
    return { owner, viewer, copy };
  });

const makePrivate = (t: T, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      aggregateId: `prof-${memberId}`,
      memberId,
      displayName: "X",
      visibility: "private",
      updatedAt: 1,
    });
  });

const view = (t: T, copyId: Id<"ownedPuzzles">, who = "viewer") =>
  as(t, who).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId,
  });

describe("getCopyInstanceView owner identity", () => {
  test("a public owner is projected with their identity and no email", async () => {
    const t = convexTest(schema, modules);
    const { owner, copy } = await seed(t);

    const result = await view(t, copy);

    expect(result?.owner).toMatchObject({
      anonymous: false,
      member: {
        _id: owner,
        name: "Olivia Owner",
        username: "owner",
        avatar: "https://avatars/owner.png",
      },
    });
    const projected = result!.owner;
    const member = projected.anonymous ? null : projected.member;
    expect(member).not.toBeNull();
    expect(member).not.toHaveProperty("email");
    expect(member).not.toHaveProperty("clerkId");
    expect(JSON.stringify(result)).not.toContain("@example.com");
  });

  test("a private owner the viewer may reach but isn't connected to is anonymised", async () => {
    const t = convexTest(schema, modules);
    // Reachable for the viewer only because they hold the copy (a loan), not via the profile.
    const { owner, viewer, copy } = await seed(t);
    await t.run((ctx) => ctx.db.patch(copy, { heldBy: viewer }));
    await makePrivate(t, owner);

    const result = await view(t, copy);

    expect(result).not.toBeNull();
    expect(Object.keys(result!.owner).sort()).toEqual(["anonRef", "anonymous"]);
    expect(result!.owner.anonymous).toBe(true);
    const json = JSON.stringify(result);
    expect(json).not.toContain(owner);
    expect(json).not.toContain("Olivia");
    expect(json).not.toContain("@example.com");
    // Not a household mate: no household person view either.
    expect(result!.household).toBeNull();
  });

  test("a private owner who is a mutual follower is revealed", async () => {
    const t = convexTest(schema, modules);
    const { owner, viewer, copy } = await seed(t);
    await t.run((ctx) => ctx.db.patch(copy, { heldBy: viewer }));
    await makePrivate(t, owner);
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: owner,
        followeeId: viewer,
        createdAt: 1,
      });
      await ctx.db.insert("follows", {
        followerId: viewer,
        followeeId: owner,
        createdAt: 1,
      });
    });

    const result = await view(t, copy);

    expect(result?.owner).toMatchObject({
      anonymous: false,
      member: { _id: owner, username: "owner" },
    });
    expect(JSON.stringify(result)).not.toContain("@example.com");
  });

  test("a household mate gets the owner's household view even when the owner is private", async () => {
    const t = convexTest(schema, modules);
    // Household-only copy: closed, so the household rule is the only way in.
    const { owner, copy } = await seed(t, {
      availability: { forTrade: false, forSale: false, forLend: false },
    });
    await makePrivate(t, owner);
    await as(t, "owner").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const viewerId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_viewer"))
        .unique(),
    );
    const inviteId = await as(t, "owner").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: viewerId!._id },
    );
    await as(t, "viewer").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );

    const result = await view(t, copy);

    // The profile projection stays anonymous (private, not mutual followers) ...
    expect(result?.owner.anonymous).toBe(true);
    // ... but the household shows who the copy belongs to, like the library badge.
    expect(result?.household?.owner).toEqual({
      memberId: owner,
      name: "Olivia Owner",
      avatar: "https://avatars/owner.png",
    });
    expect(JSON.stringify(result)).not.toContain("@example.com");

    // The owner sees themself in the household block too.
    const ownView = await view(t, copy, "owner");
    expect(ownView?.household?.owner.memberId).toBe(owner);
  });
});
