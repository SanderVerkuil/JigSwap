import type { ProjectedMember } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { projectMemberIdentity } from "./social/privacy";

// #280: when the VIEWER blocked a member they could already see (public profile or a shared
// circle), that member stays named so the viewer can recognise and unblock them (#169), but
// identity only: name, handle, avatar. A block never unlocks profile details (bio, location,
// preferred language, library, stats) the viewer could not see before. SEC-40: a block never
// names a member the viewer could NOT see either: a hidden member stays the same anonymous entry,
// so blocking a candidate can't confirm who an anonymous entry is. When the TARGET blocked the
// viewer, the target stays anonymous / not found.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Visibility = "public" | "private";

const PROFILE_DETAILS = ["bio", "location", "preferredLanguage"] as const;

// Alice is the viewer. Bob carries every profile detail, a profile row with a bio, and one open
// copy. Alice owns a copy bob used to own, so bob appears in its custody timeline.
const seed = (t: T, visibility: Visibility) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      username: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      name: "bob",
      username: "bob",
      avatar: "https://example.com/bob.png",
      bio: "secret bio",
      location: "Utrecht",
      preferredLanguage: "nl",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: bob,
      displayName: "Bobby",
      bio: "profile bio",
      visibility,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const aliceCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("copyCustodyEntries", {
      copyId: aliceCopy,
      exchangeId: "exchange-1",
      previousOwner: bob,
      newOwner: alice,
      occurredAt: now,
    });
    return { alice, bob, aliceCopy };
  });

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });

const expectNoProfileDetails = (value: object | undefined) => {
  for (const field of PROFILE_DETAILS) expect(value).not.toHaveProperty(field);
};

const expectIdentityOnly = (
  projected: ProjectedMember | undefined,
  bob: Id<"users">,
) => {
  expect(projected?.anonymous).toBe(false);
  if (!projected || projected.anonymous) return;
  expect(projected.member).toMatchObject({
    _id: bob,
    name: "bob",
    username: "bob",
    avatar: "https://example.com/bob.png",
  });
  expectNoProfileDetails(projected.member);
};

// Alice and bob share one circle (the circle rule names a private co-member, identity only).
const seatInSharedCircle = (
  t: T,
  u: { alice: Id<"users">; bob: Id<"users"> },
) =>
  t.run(async (ctx) => {
    for (const memberId of [u.alice, u.bob]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-1",
        memberId,
      });
    }
  });

describe("viewer blocked a public member: identity only", () => {
  test("projectMemberIdentity reveals name, handle and avatar, no profile details", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "public");
    await block(t, u.alice, u.bob);
    const projected = await t.run((ctx) =>
      projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
    );
    expectIdentityOnly(projected, u.bob);
  });

  test("a caller (custody timeline) ships no profile details", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "public");
    await block(t, u.alice, u.bob);
    const timeline = await asAlice(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: u.aliceCopy },
    );
    expectIdentityOnly(timeline?.originalOwner, u.bob);
  });
});

// SEC-40: blocking must not work as a de-anonymisation oracle. Before the fix, blocking a
// candidate turned the anonymous entry into the candidate's name.
describe("viewer blocked a private member they can't see: still anonymous", () => {
  test("projectMemberIdentity returns the same anonymous ref as before the block", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    const before = await t.run((ctx) =>
      projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
    );
    await block(t, u.alice, u.bob);
    const after = await t.run((ctx) =>
      projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
    );
    // No `blocked` flag either: any marker that appears only after blocking is itself the oracle.
    expect(Object.keys(after).sort()).toEqual(["anonRef", "anonymous"]);
    expect(after).toEqual(before);
  });

  test("the custody timeline keeps the original owner anonymous", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    await block(t, u.alice, u.bob);
    const timeline = await asAlice(t).query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: u.aliceCopy },
    );
    expect(timeline?.originalOwner.anonymous).toBe(true);
    expect(JSON.stringify(timeline)).not.toContain(u.bob);
  });

  test("an anonymous transfer entry on the copy page keeps its anonRef after the block", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    const alice = asAlice(t);
    const transferFrom = async () => {
      const view = await alice.query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: u.aliceCopy },
      );
      expect(view?.transfers).toHaveLength(1);
      return view?.transfers[0]?.from;
    };
    const before = await transferFrom();
    expect(before?.anonymous).toBe(true);
    await block(t, u.alice, u.bob);
    expect(await transferFrom()).toEqual(before);
  });

  test("a circle co-member stays named, identity only, through the circle rule", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "private");
    await seatInSharedCircle(t, u);
    await block(t, u.alice, u.bob);
    const projected = await t.run((ctx) =>
      projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
    );
    expectIdentityOnly(projected, u.bob);
  });
});

describe.each(["private", "public"] as const)(
  "viewer blocked a %s member: identity stubs",
  (visibility) => {
    test("profile and teaser reads return identity stubs only", async () => {
      const t = convexTest(schema, modules);
      const u = await seed(t, visibility);
      await block(t, u.alice, u.bob);
      const alice = asAlice(t);

      const teaser = await alice.query(
        api.social.getPublicMemberTeaser.getPublicMemberTeaser,
        { handle: "bob" },
      );
      expect(teaser).toMatchObject({
        memberId: u.bob,
        displayName: "Bobby",
        username: "bob",
        puzzleCount: null,
        blockedByMe: true,
      });
      expectNoProfileDetails(teaser ?? undefined);

      const profile = await alice.query(
        api.social.getPublicProfile.getPublicProfile,
        { handle: "bob" },
      );
      expect(profile).toMatchObject({
        locked: true,
        blockedByMe: true,
        hero: {
          memberId: u.bob,
          displayName: "Bobby",
          rating: 0,
          reviewCount: 0,
          followerCount: 0,
          followingCount: 0,
        },
      });
      expect(profile?.hero).not.toHaveProperty("location");
      for (const field of ["story", "stats", "records", "currentlySolving"]) {
        expect(profile).not.toHaveProperty(field);
      }

      const social = await alice.query(api.social.getProfile.getProfile, {
        memberId: u.bob,
      });
      expect(social).toMatchObject({ displayName: "Bobby", blockedByMe: true });
      expect(social).not.toHaveProperty("bio");
    });
  },
);

test("a block never unlocks a private member's MemberView or stats", async () => {
  const t = convexTest(schema, modules);
  const u = await seed(t, "private");
  await block(t, u.alice, u.bob);
  const alice = asAlice(t);
  expect(
    await alice.query(api.identity.getUserById.getUserById, { userId: u.bob }),
  ).toBeNull();
  expect(
    await alice.query(api.identity.getUserStats.getUserStats, {
      userId: u.bob,
    }),
  ).toBeNull();
});

describe("target blocked the viewer: anonymous / not found", () => {
  test.each(["private", "public"] as const)(
    "%s target: projection carries only the anonRef",
    async (visibility) => {
      const t = convexTest(schema, modules);
      const u = await seed(t, visibility);
      await block(t, u.bob, u.alice);
      const projected = await t.run((ctx) =>
        projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
      );
      expect(Object.keys(projected).sort()).toEqual(["anonRef", "anonymous"]);
      expect(projected.anonymous).toBe(true);

      const timeline = await asAlice(t).query(
        api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
        { copyId: u.aliceCopy },
      );
      expect(timeline?.originalOwner.anonymous).toBe(true);
    },
  );

  test("profile, teaser and member reads return null", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t, "public");
    await block(t, u.bob, u.alice);
    const alice = asAlice(t);
    expect(
      await alice.query(
        api.social.getPublicMemberTeaser.getPublicMemberTeaser,
        { handle: "bob" },
      ),
    ).toBeNull();
    expect(
      await alice.query(api.social.getPublicProfile.getPublicProfile, {
        handle: "bob",
      }),
    ).toBeNull();
    expect(
      await alice.query(api.social.getProfile.getProfile, { memberId: u.bob }),
    ).toBeNull();
    expect(
      await alice.query(api.identity.getUserById.getUserById, {
        userId: u.bob,
      }),
    ).toBeNull();
  });
});

test("a departed member the viewer blocked stays a departed anonymous seat", async () => {
  const t = convexTest(schema, modules);
  const u = await seed(t, "public");
  await block(t, u.alice, u.bob);
  await t.run((ctx) => ctx.db.patch(u.bob, { isActive: false }));
  const projected = await t.run((ctx) =>
    projectMemberIdentity(ctx, u.alice, u.bob, "salt"),
  );
  expect(projected).toMatchObject({ anonymous: true, departed: true });
  expect(projected).not.toHaveProperty("member");
});
