import type { ProjectedMember } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  canSeeProfileContent,
  isRevealedByOrdinaryRules,
  projectMemberIdentity,
} from "./social/privacy";

// Product decision (#152): sharing a circle IS an identity reveal. Members who are CURRENTLY in the
// same circle see each other's identity, through the projectMemberIdentity chokepoint, on every
// surface. Identity ONLY: it never unlocks a private member's profile content.

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CIRCLE = "circle-1";

const asViewer = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_viewer" });
const asHost = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_host" });

// Seed:
//   viewer  — the reading member, in CIRCLE (plain member).
//   host    — PRIVATE, owns CIRCLE (owner seat), not a mutual follower of the viewer.
//   pubby   — PUBLIC, in CIRCLE, not a mutual follower.
//   priv    — PRIVATE, in CIRCLE, not a mutual follower; has a bio + location.
//   gone    — PRIVATE, in CIRCLE, but departed (isActive === false).
//   stranger— PRIVATE, in no circle with the viewer; has only PENDING relationships with them.
// Every circle member (except the viewer) has an OPEN copy shared into CIRCLE.
const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: { isActive?: boolean; bio?: string; location?: string } = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        username: `${name.toLowerCase()}_handle`,
        isActive: extra.isActive ?? true,
        bio: extra.bio,
        location: extra.location,
        createdAt: now,
        updatedAt: now,
      });
    const priv = async (memberId: Id<"users">) => {
      await ctx.db.insert("profiles", {
        memberId,
        visibility: "private",
        updatedAt: now,
      });
    };

    const viewer = await mkUser("clerk_viewer", "Viewer");
    const host = await mkUser("clerk_host", "Hosty");
    const pubby = await mkUser("clerk_pubby", "Pubby");
    const privy = await mkUser("clerk_privy", "Privy", {
      bio: "Secret bio",
      location: "Secret Town",
    });
    const gone = await mkUser("clerk_gone", "Gonzo", { isActive: false });
    const stranger = await mkUser("clerk_stranger", "Strange");
    for (const id of [host, privy, gone, stranger]) await priv(id);

    // One-directional follows only (never mutual) between viewer and the circle-mates.
    await ctx.db.insert("follows", {
      followerId: viewer,
      followeeId: privy,
      createdAt: now,
    });

    // PENDING-only relationships with the stranger: a follow request and a household invite.
    await ctx.db.insert("followRequests", {
      aggregateId: "fr-1",
      requesterId: stranger,
      targetId: viewer,
      status: "pending",
      createdAt: now,
    });
    await ctx.db.insert("householdInvites", {
      aggregateId: "hi-1",
      householdId: "hh-1",
      inviterId: stranger,
      inviteeId: viewer,
      status: "pending",
      createdAt: now,
    });

    const members = [host, viewer, pubby, privy, gone];
    await ctx.db.insert("circles", {
      aggregateId: CIRCLE,
      ownerId: host,
      name: "Saturday Puzzlers",
      memberships: members.map((memberId, i) => ({
        id: `m-${i}`,
        memberId,
        permission:
          memberId === host ? ("Admin" as const) : ("Exchange" as const),
        joinedAt: now,
      })),
      createdAt: now,
    });
    for (const memberId of members) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: CIRCLE,
        memberId,
      });
    }

    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: viewer,
      createdAt: now,
      updatedAt: now,
    });
    for (const [aggregateId, ownerId] of [
      ["copy-host", host],
      ["copy-pubby", pubby],
      ["copy-privy", privy],
      ["copy-gone", gone],
    ] as const) {
      await ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability: OPEN,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("circleCopyShares", {
        circleId: CIRCLE,
        copyId: aggregateId,
        sharedAt: now,
      });
    }

    return { viewer, host, pubby, privy, gone, stranger, puzzle };
  });

const project = (
  t: TestConvex<typeof schema>,
  viewerId: Id<"users">,
  targetId: Id<"users">,
) => t.run((ctx) => projectMemberIdentity(ctx, viewerId, targetId, "salt"));

const nameOf = (m: ProjectedMember | undefined): string | null =>
  m && !m.anonymous ? (m.member.name ?? null) : null;

describe("projectMemberIdentity: circle reveal rule", () => {
  test("a private, non-mutual circle-mate is revealed — identity only (no bio/location)", async () => {
    const t = convexTest(schema, modules);
    const { viewer, privy } = await seed(t);

    const p = await project(t, viewer, privy);
    expect(p.anonymous).toBe(false);
    expect(nameOf(p)).toBe("Privy");
    const json = JSON.stringify(p);
    expect(json).not.toContain("Secret bio");
    expect(json).not.toContain("Secret Town");
  });

  test("the circle owner and a member reveal to each other", async () => {
    const t = convexTest(schema, modules);
    const { viewer, host, privy } = await seed(t);

    expect(nameOf(await project(t, viewer, host))).toBe("Hosty");
    expect(nameOf(await project(t, host, viewer))).toBe("Viewer");
    expect(nameOf(await project(t, host, privy))).toBe("Privy");
  });

  test("being removed from the circle ends the reveal", async () => {
    const t = convexTest(schema, modules);
    const { viewer, privy } = await seed(t);
    expect(nameOf(await project(t, viewer, privy))).toBe("Privy");

    // The circle owner removes Privy through the real mutation (repository syncs the junction).
    await asHost(t).mutation(api.sharing.removeMember.removeMember, {
      circleId: CIRCLE,
      memberId: privy,
    });

    const after = await project(t, viewer, privy);
    expect(after.anonymous).toBe(true);
    expect(JSON.stringify(after)).not.toContain(privy);
    expect(JSON.stringify(after)).not.toContain("Privy");
  });

  test("pending relationships (follow request, household invite) do not reveal", async () => {
    const t = convexTest(schema, modules);
    const { viewer, stranger } = await seed(t);

    const p = await project(t, viewer, stranger);
    expect(p.anonymous).toBe(true);
    expect(JSON.stringify(p)).not.toContain(stranger);
    expect(JSON.stringify(p)).not.toContain("Strange");
  });

  test("a non-circle private member stays anonymous (and is not flagged departed)", async () => {
    const t = convexTest(schema, modules);
    const { viewer, stranger } = await seed(t);

    const p = await project(t, viewer, stranger);
    expect(p).toEqual({ anonymous: true, anonRef: expect.any(String) });
  });

  test("a departed (inactive) circle-mate is never revealed by the circle rule — departed anon", async () => {
    const t = convexTest(schema, modules);
    const { viewer, gone } = await seed(t);

    const p = await project(t, viewer, gone);
    expect(p).toEqual({
      anonymous: true,
      anonRef: expect.any(String),
      departed: true,
    });
    expect(JSON.stringify(p)).not.toContain(gone);
    expect(JSON.stringify(p)).not.toContain("Gonzo");
  });

  test("a deleted member (no users row) projects as a departed anonymous member", async () => {
    const t = convexTest(schema, modules);
    const { viewer, privy } = await seed(t);
    await t.run((ctx) => ctx.db.delete(privy));

    const p = await project(t, viewer, privy);
    expect(p).toEqual({
      anonymous: true,
      anonRef: expect.any(String),
      departed: true,
    });
  });

  test("isRevealedByOrdinaryRules is public || mutual — circle membership is NOT part of it", async () => {
    const t = convexTest(schema, modules);
    const { viewer, pubby, privy } = await seed(t);

    await t.run(async (ctx) => {
      expect(await isRevealedByOrdinaryRules(ctx, viewer, pubby)).toBe(true);
      expect(await isRevealedByOrdinaryRules(ctx, viewer, privy)).toBe(false);
      await ctx.db.insert("follows", {
        followerId: privy,
        followeeId: viewer,
        createdAt: Date.now(),
      });
      expect(await isRevealedByOrdinaryRules(ctx, viewer, privy)).toBe(true);
    });
  });
});

describe("circle reveal does NOT unlock profile content", () => {
  test("canSeeProfileContent stays false and getPublicProfile stays locked for a circle-mate", async () => {
    const t = convexTest(schema, modules);
    const { viewer, privy } = await seed(t);

    expect(await t.run((ctx) => canSeeProfileContent(ctx, viewer, privy))).toBe(
      false,
    );

    const profile = await asViewer(t).query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "privy_handle" },
    );
    expect(profile?.locked).toBe(true);
    expect(JSON.stringify(profile)).not.toContain("Secret bio");
    expect(JSON.stringify(profile)).not.toContain("Secret Town");
  });
});

describe("browse projects circle-copy owners through the chokepoint", () => {
  const browse = (t: TestConvex<typeof schema>) =>
    asViewer(t).query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {});

  test("a PRIVATE owner's circle copy, viewed by a non-mutual circle member: owner revealed", async () => {
    const t = convexTest(schema, modules);
    const { privy } = await seed(t);

    const view = await browse(t);
    const row = view.ownedPuzzles.find((c) => c.aggregateId === "copy-privy");
    expect(row).toBeDefined();
    expect(row!.owner.anonymous).toBe(false);
    expect(nameOf(row!.owner)).toBe("Privy");
    expect(row!.ownerId).toBe(privy);
    // Identity only: no profile content rides along.
    expect(JSON.stringify(row)).not.toContain("Secret Town");
  });

  test("a PUBLIC owner's circle copy, viewed by a non-mutual circle member: owner revealed", async () => {
    const t = convexTest(schema, modules);
    const { pubby } = await seed(t);

    const view = await browse(t);
    const row = view.ownedPuzzles.find((c) => c.aggregateId === "copy-pubby");
    expect(row).toBeDefined();
    expect(nameOf(row!.owner)).toBe("Pubby");
    expect(row!.ownerId).toBe(pubby);
  });

  test("a departed private circle owner is anonymous (departed) and their id/name never leave the server", async () => {
    const t = convexTest(schema, modules);
    const { gone } = await seed(t);

    const view = await browse(t);
    const row = view.ownedPuzzles.find((c) => c.aggregateId === "copy-gone");
    expect(row).toBeDefined();
    expect(row!.owner).toEqual({
      anonymous: true,
      anonRef: expect.any(String),
      departed: true,
    });
    expect(row!.ownerId).toBeUndefined();
    const json = JSON.stringify(row);
    expect(json).not.toContain(gone);
    expect(json).not.toContain("Gonzo");
    expect(json).not.toContain("gonzo_handle");
  });

  test("the anonRef is salted per copy (matches getCopyInstanceView's owner projection)", async () => {
    const t = convexTest(schema, modules);
    const { viewer, gone } = await seed(t);

    const view = await browse(t);
    const row = view.ownedPuzzles.find((c) => c.aggregateId === "copy-gone")!;
    const expected = await t.run((ctx) =>
      projectMemberIdentity(ctx, viewer, gone, row._id as string),
    );
    expect(row.owner).toEqual(expected);
  });
});

describe("other circle surfaces project members consistently", () => {
  test("getCircle: circle-mates revealed, a departed member is anonymous + flagged departed", async () => {
    const t = convexTest(schema, modules);
    const { gone, privy } = await seed(t);

    const circle = await asViewer(t).query(api.sharing.getCircle.getCircle, {
      circleId: CIRCLE,
    });
    const byId = new Map(circle!.members.map((m) => [m.memberId, m]));
    expect(byId.get(privy)?.name).toBe("Privy");
    const departed = byId.get(gone)!;
    expect(departed.departed).toBe(true);
    expect(departed.name).toBeUndefined();
    expect(departed.username).toBeUndefined();
    expect(JSON.stringify(departed)).not.toContain("Gonzo");
  });

  test("getPuzzleDefinitionView: circle owner named without location; departed owner unnamed", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);

    const view = await asViewer(t).query(
      api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
      { puzzleId: puzzle },
    );
    const names = view!.availableCopies.map((c) => c.owner.name);
    expect(names).toContain("Privy");
    expect(names).toContain("Hosty");
    const json = JSON.stringify(view);
    expect(json).not.toContain("Gonzo");
    expect(json).not.toContain("Secret Town");
  });
});

// Insert an extra member directly (outside the shared seed), optionally seated in CIRCLE.
const addUser = (
  t: TestConvex<typeof schema>,
  opts: {
    clerkId: string;
    name: string;
    isActive: boolean;
    visibility?: "public" | "private";
    inCircle?: boolean;
  },
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId: opts.clerkId,
      email: `${opts.clerkId}@example.com`,
      name: opts.name,
      isActive: opts.isActive,
      createdAt: now,
      updatedAt: now,
    });
    if (opts.visibility) {
      await ctx.db.insert("profiles", {
        memberId: id,
        visibility: opts.visibility,
        updatedAt: now,
      });
    }
    if (opts.inCircle) {
      const circle = (await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", CIRCLE))
        .unique())!;
      await ctx.db.patch(circle._id, {
        memberships: [
          ...circle.memberships,
          {
            id: `m-${opts.clerkId}`,
            memberId: id,
            permission: "ViewOnly",
            joinedAt: now,
          },
        ],
      });
      await ctx.db.insert("circleMembers", {
        circleAggregateId: CIRCLE,
        memberId: id,
      });
    }
    return id;
  });

const DEPARTED = {
  anonymous: true,
  anonRef: expect.any(String),
  departed: true,
};

describe("departed members are never revealed, by any rule", () => {
  test("a PUBLIC inactive circle-mate projects departed", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await seed(t);
    const pubGone = await addUser(t, {
      clerkId: "clerk_pubgone",
      name: "PubGone",
      isActive: false,
      inCircle: true,
    });

    const p = await project(t, viewer, pubGone);
    expect(p).toEqual(DEPARTED);
    expect(JSON.stringify(p)).not.toContain("PubGone");
  });

  test("a PUBLIC inactive non-circle member projects departed", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await seed(t);
    const pubStranger = await addUser(t, {
      clerkId: "clerk_pubstranger",
      name: "PubStranger",
      isActive: false,
      visibility: "public",
    });

    expect(await project(t, viewer, pubStranger)).toEqual(DEPARTED);
  });

  test("a MUTUAL-follower inactive member projects departed", async () => {
    const t = convexTest(schema, modules);
    const { viewer, gone } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("follows", {
        followerId: viewer,
        followeeId: gone,
        createdAt: 1,
      });
      await ctx.db.insert("follows", {
        followerId: gone,
        followeeId: viewer,
        createdAt: 2,
      });
    });

    expect(await project(t, viewer, gone)).toEqual(DEPARTED);
  });

  test("getCircle: a PUBLIC inactive member's seat shows departed, no name", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const pubGone = await addUser(t, {
      clerkId: "clerk_pubgone",
      name: "PubGone",
      isActive: false,
      inCircle: true,
    });

    const circle = await asViewer(t).query(api.sharing.getCircle.getCircle, {
      circleId: CIRCLE,
    });
    const seat = circle!.members.find((m) => m.memberId === pubGone)!;
    expect(seat.departed).toBe(true);
    expect(seat.name).toBeUndefined();
    expect(JSON.stringify(seat)).not.toContain("PubGone");
  });
});

describe("the circle-reveal view is identity only", () => {
  test("it carries exactly the identity keys (no bio, location, preferredLanguage)", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await seed(t);
    const full = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("users", {
        clerkId: "clerk_full",
        email: "full@example.com",
        name: "Fully",
        username: "fully",
        avatar: "https://example.com/a.png",
        bio: "Bio",
        location: "Town",
        preferredLanguage: "nl",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        memberId: id,
        visibility: "private",
        updatedAt: now,
      });
      await ctx.db.insert("circleMembers", {
        circleAggregateId: CIRCLE,
        memberId: id,
      });
      return id;
    });

    const p = await project(t, viewer, full);
    expect(p.anonymous).toBe(false);
    if (p.anonymous) return;
    expect(Object.keys(p.member).sort()).toEqual([
      "_creationTime",
      "_id",
      "avatar",
      "createdAt",
      "isActive",
      "name",
      "updatedAt",
      "username",
    ]);
  });
});

describe("circle membership follows the real junction", () => {
  test("adding a member through the REAL addMember reveals; removeMember ends it", async () => {
    const t = convexTest(schema, modules);
    const { viewer, stranger } = await seed(t);
    expect((await project(t, viewer, stranger)).anonymous).toBe(true);

    await asHost(t).mutation(api.sharing.addMember.addMember, {
      circleId: CIRCLE,
      memberId: stranger,
      permission: "ViewOnly",
    });
    expect(nameOf(await project(t, viewer, stranger))).toBe("Strange");

    await asHost(t).mutation(api.sharing.removeMember.removeMember, {
      circleId: CIRCLE,
      memberId: stranger,
    });
    expect((await project(t, viewer, stranger)).anonymous).toBe(true);
  });

  test("a circles.memberships entry WITHOUT a junction row does not reveal", async () => {
    const t = convexTest(schema, modules);
    const { viewer, stranger } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("circles", {
        aggregateId: "circle-desync",
        ownerId: viewer,
        name: "Desynced",
        memberships: [
          { id: "d-1", memberId: viewer, permission: "Admin", joinedAt: 1 },
          {
            id: "d-2",
            memberId: stranger,
            permission: "ViewOnly",
            joinedAt: 1,
          },
        ],
        createdAt: 1,
      });
      // Junction row for the viewer only — the stranger's seat was never projected.
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-desync",
        memberId: viewer,
      });
    });

    expect((await project(t, viewer, stranger)).anonymous).toBe(true);
  });
});

describe("conversation surfaces for a circle-mate", () => {
  const dmWithPrivy = async (t: TestConvex<typeof schema>) => {
    const s = await seed(t);
    // Private copies of Privy that are NOT circle-shared: one open, one closed.
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [aggregateId, forTrade] of [
        ["copy-privy-unshared", true],
        ["copy-privy-closed", false],
      ] as const) {
        await ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId: s.puzzle,
          ownerId: s.privy,
          condition: "good",
          availability: { forTrade, forSale: false, forLend: false },
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    // Circle-mates are "connected", so the viewer may open a DM with Privy.
    const threadId = await asViewer(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: s.privy },
    );
    await asViewer(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "Hi",
    });
    return { ...s, threadId };
  };

  test("listAttachableCopies('theirs') returns only copies passing canViewCopy", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await dmWithPrivy(t);

    const copies = await asViewer(t).query(
      api.conversation.listAttachableCopies.listAttachableCopies,
      { threadId, side: "theirs" },
    );
    const ids = await t.run(async (ctx) =>
      Promise.all(
        copies.map(
          async (c) =>
            (await ctx.db.get(c.copyId as Id<"ownedPuzzles">))?.aggregateId,
        ),
      ),
    );
    expect(ids).toEqual(["copy-privy"]);
  });

  test("getMyInbox reveals the circle-mate with a profileHandle, but their profile stays locked", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await dmWithPrivy(t);

    const inbox = await asViewer(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    const row = inbox.find((r) => r.threadId === threadId)!;
    expect(row.subject.kind).toBe("dm");
    if (row.subject.kind !== "dm") return;
    expect(nameOf(row.subject.otherMember)).toBe("Privy");
    expect(row.subject.profileHandle).toBe("privy_handle");

    const profile = await asViewer(t).query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: row.subject.profileHandle! },
    );
    expect(profile?.locked).toBe(true);
  });
});
