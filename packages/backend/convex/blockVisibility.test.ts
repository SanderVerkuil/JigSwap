import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewCopy } from "./library/canViewCopy";
import { handleDomainEvent } from "./notifications/subscriber";
import schema from "./schema";
import { resolveHouseholdLink } from "./social/householdLinkInvite";
import { projectMemberIdentity } from "./social/privacy";

// Block visibility gates (spec 2.6): a block is silent and works both ways. Each gate is checked
// from both sides where it applies; block rows are written directly so a gate is tested without
// blockMember's side effects (follow edges stay, so a list filter is what hides the member).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol";
type Users = Record<Who, Id<"users">>;

const seed = (t: T): Promise<Users> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        username: name,
        searchableName: `${name} puzzler`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("alice"),
      bob: await mkUser("bob"),
      carol: await mkUser("carol"),
    };
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const insertBlock = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: Date.now() }),
  );

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", {
      aggregateId: crypto.randomUUID(),
      followerId,
      followeeId,
      createdAt: Date.now(),
    }),
  );

const seedPuzzle = (t: T, submittedBy: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("puzzles", {
      title: "Test Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

// An OPEN copy (for sale), so a public owner's copy is viewable by anyone.
const seedOpenCopy = async (
  t: T,
  ownerId: Id<"users">,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) => {
  const puzzleId = await seedPuzzle(t, ownerId);
  return t.run((ctx) =>
    ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId,
      condition: "good",
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }),
  );
};

const viewable = (t: T, viewerId: Id<"users">, copyId: Id<"ownedPuzzles">) =>
  t.run(async (ctx) => {
    const copy = await ctx.db.get(copyId);
    if (!copy) throw new Error("copy not seeded");
    return canViewCopy(ctx, viewerId, copy);
  });

// Both directions: [blocker, blocked]. "Blocked" means either way, so each symmetric gate runs
// once with alice as the blocker and once with bob as the blocker; the viewer is always alice.
const DIRECTIONS = [
  ["alice blocked bob", (u: Users) => [u.alice, u.bob] as const],
  ["bob blocked alice", (u: Users) => [u.bob, u.alice] as const],
] as const;

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError<{ code: string }>).data.code).toBe(code);
};

describe("projectMemberIdentity", () => {
  test("blocked by the target: the target is anonymous, self stays revealed", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await insertBlock(t, u.bob, u.alice);
    await t.run(async (ctx) => {
      const other = await projectMemberIdentity(ctx, u.alice, u.bob, "salt");
      expect(other.anonymous).toBe(true);
      expect(other).not.toHaveProperty("member");
      const self = await projectMemberIdentity(ctx, u.alice, u.alice, "salt");
      expect(self.anonymous).toBe(false);
    });
  });

  test("the blocker still sees who they blocked, even when that profile is private", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("profiles", {
        memberId: u.bob,
        visibility: "private",
        updatedAt: Date.now(),
      });
    });
    await insertBlock(t, u.alice, u.bob);
    await t.run(async (ctx) => {
      const other = await projectMemberIdentity(ctx, u.alice, u.bob, "salt");
      expect(other.anonymous).toBe(false);
    });
  });

  test("an unblocked public member is still revealed", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await t.run(async (ctx) => {
      expect(
        (await projectMemberIdentity(ctx, u.alice, u.bob, "salt")).anonymous,
      ).toBe(false);
    });
  });
});

describe("canViewCopy", () => {
  test.each(DIRECTIONS)(
    "%s: a public open copy is not viewable",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const copy = await seedOpenCopy(t, u.bob);
      expect(await viewable(t, u.alice, copy)).toBe(true);
      await insertBlock(t, ...pair(u));
      expect(await viewable(t, u.alice, copy)).toBe(false);
    },
  );

  test.each(DIRECTIONS)(
    "%s: a household mate's copy is not viewable",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const copy = await seedOpenCopy(t, u.bob, {
        availability: { forTrade: false, forSale: false, forLend: false },
      });
      await t.run(async (ctx) => {
        for (const memberId of [u.alice, u.bob]) {
          await ctx.db.insert("householdMembers", {
            householdId: "hh-1",
            memberId,
            role: memberId === u.alice ? "admin" : "member",
            joinedAt: Date.now(),
          });
        }
      });
      expect(await viewable(t, u.alice, copy)).toBe(true);
      await insertBlock(t, ...pair(u));
      expect(await viewable(t, u.alice, copy)).toBe(false);
    },
  );

  test.each(DIRECTIONS)(
    "%s: a private copy is not viewable through the exchange-party rule",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      // Private per-copy visibility (#155): only an exchange party may see it.
      const copy = await seedOpenCopy(t, u.bob, {
        availability: { forTrade: false, forSale: false, forLend: false },
        visibility: "private",
        visibilityAuthoritative: true,
      });
      await t.run((ctx) =>
        ctx.db.insert("exchanges", {
          aggregateId: "exch-private",
          initiatorId: u.alice,
          recipientId: u.bob,
          type: "trade",
          requestedPuzzleId: copy,
          status: "accepted",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
      expect(await viewable(t, u.alice, copy)).toBe(true);
      await insertBlock(t, ...pair(u));
      expect(await viewable(t, u.alice, copy)).toBe(false);
    },
  );

  test.each(DIRECTIONS)(
    "%s: a circle-shared copy is not viewable",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const copy = await seedOpenCopy(t, u.bob, { aggregateId: "copy-b" });
      await t.run(async (ctx) => {
        const now = Date.now();
        // A private owner, so only the circle share makes the copy viewable.
        await ctx.db.insert("profiles", {
          memberId: u.bob,
          visibility: "private",
          updatedAt: now,
        });
        await ctx.db.insert("circles", {
          aggregateId: "circle-1",
          ownerId: u.bob,
          name: "Saturday Puzzlers",
          memberships: [
            { id: "m-b", memberId: u.bob, permission: "Admin", joinedAt: now },
            {
              id: "m-a",
              memberId: u.alice,
              permission: "ViewOnly",
              joinedAt: now,
            },
          ],
          createdAt: now,
        });
        for (const memberId of [u.alice, u.bob]) {
          await ctx.db.insert("circleMembers", {
            circleAggregateId: "circle-1",
            memberId,
          });
        }
        await ctx.db.insert("circleCopyShares", {
          circleId: "circle-1",
          copyId: "copy-b",
          sharedAt: now,
        });
      });
      expect(await viewable(t, u.alice, copy)).toBe(true);
      await insertBlock(t, ...pair(u));
      expect(await viewable(t, u.alice, copy)).toBe(false);
    },
  );

  test.each(DIRECTIONS)(
    "%s: the member holding the copy keeps access",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const copy = await seedOpenCopy(t, u.bob, { heldBy: u.alice });
      await insertBlock(t, ...pair(u));
      expect(await viewable(t, u.alice, copy)).toBe(true);
    },
  );
});

describe("profiles", () => {
  const seedProfile = (t: T, memberId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId,
        displayName: "Bobby",
        bio: "I like skies",
        visibility: "public",
        updatedAt: Date.now(),
      }),
    );

  test("the blocked side reads the blocker as not found", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await seedProfile(t, u.bob);
    await insertBlock(t, u.bob, u.alice);
    const alice = as(t, "alice");
    expect(
      await alice.query(api.social.getPublicProfile.getPublicProfile, {
        handle: "bob",
      }),
    ).toBeNull();
    expect(
      await alice.query(
        api.social.getPublicMemberTeaser.getPublicMemberTeaser,
        {
          handle: "bob",
        },
      ),
    ).toBeNull();
    expect(
      await alice.query(api.social.getProfile.getProfile, { memberId: u.bob }),
    ).toBeNull();
    // The relation a missing member reads as: nothing, and no blockedByMe flag.
    expect(
      await alice.query(api.social.getFollowRelation.getFollowRelation, {
        memberId: u.bob,
      }),
    ).toEqual({
      following: false,
      followsYou: false,
      targetIsPrivate: false,
      pendingRequest: null,
    });
  });

  test.each(DIRECTIONS)(
    "%s: the follow relation stub keeps a private target's targetIsPrivate",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await t.run((ctx) =>
        ctx.db.insert("profiles", {
          memberId: u.bob,
          visibility: "private",
          updatedAt: Date.now(),
        }),
      );
      await insertBlock(t, ...pair(u));
      expect(
        await as(t, "alice").query(
          api.social.getFollowRelation.getFollowRelation,
          { memberId: u.bob },
        ),
      ).toMatchObject({ following: false, targetIsPrivate: true });
    },
  );

  test("the identity reads return the blocker as not found to the blocked side only", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await insertBlock(t, u.bob, u.alice);
    const reads = (who: Who, target: Id<"users">, clerkId: string) =>
      Promise.all([
        as(t, who).query(api.identity.getUserById.getUserById, {
          userId: target,
        }),
        as(t, who).query(api.identity.getUserStats.getUserStats, {
          userId: target,
        }),
        as(t, who).query(api.identity.getUserByClerkId.getUserByClerkId, {
          clerkId,
        }),
      ]);

    // Alice was blocked by bob: bob reads as not found.
    expect(await reads("alice", u.bob, "clerk_bob")).toEqual([
      null,
      null,
      null,
    ]);
    // Bob (the blocker) still sees alice; each member still sees themselves.
    for (const [who, target, clerkId] of [
      ["bob", u.alice, "clerk_alice"],
      ["alice", u.alice, "clerk_alice"],
      ["bob", u.bob, "clerk_bob"],
    ] as const) {
      const [member, stats, byClerk] = await reads(who, target, clerkId);
      expect(member).toMatchObject({ _id: target });
      expect(stats).not.toBeNull();
      expect(byClerk).toMatchObject({ _id: target });
    }
  });

  test("the blocker gets a minimal stub flagged blockedByMe", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await seedProfile(t, u.bob);
    await follow(t, u.alice, u.bob);
    await insertBlock(t, u.alice, u.bob);
    const alice = as(t, "alice");

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
        username: "bob",
        followerCount: 0,
      },
    });
    expect(profile).not.toHaveProperty("story");

    expect(
      await alice.query(
        api.social.getPublicMemberTeaser.getPublicMemberTeaser,
        {
          handle: "bob",
        },
      ),
    ).toMatchObject({
      memberId: u.bob,
      displayName: "Bobby",
      puzzleCount: null,
      blockedByMe: true,
    });

    const social = await alice.query(api.social.getProfile.getProfile, {
      memberId: u.bob,
    });
    expect(social).toMatchObject({ displayName: "Bobby", blockedByMe: true });
    expect(social?.bio).toBeUndefined();

    expect(
      await alice.query(api.social.getFollowRelation.getFollowRelation, {
        memberId: u.bob,
      }),
    ).toMatchObject({ following: false, blockedByMe: true });
  });
});

describe("follow lists", () => {
  test.each(DIRECTIONS)(
    "%s: followers, followees and incoming requests drop the other member",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      // Both follow carol and carol follows both; bob has a pending request to alice.
      await follow(t, u.alice, u.carol);
      await follow(t, u.bob, u.carol);
      await follow(t, u.carol, u.alice);
      await follow(t, u.carol, u.bob);
      await t.run((ctx) =>
        ctx.db.insert("followRequests", {
          aggregateId: "req-1",
          requesterId: u.bob,
          targetId: u.alice,
          status: "pending",
          createdAt: Date.now(),
        }),
      );
      await insertBlock(t, ...pair(u));
      const alice = as(t, "alice");

      const followers = await alice.query(
        api.social.listFollowers.listFollowers,
        { memberId: u.carol },
      );
      expect(followers.map((f) => f.memberId)).toEqual([u.alice]);
      const followees = await alice.query(
        api.social.listFollowees.listFollowees,
        { memberId: u.carol },
      );
      expect(followees.map((f) => f.memberId)).toEqual([u.alice]);
      // The blocked member's own lists read as empty.
      expect(
        await alice.query(api.social.listFollowers.listFollowers, {
          memberId: u.bob,
        }),
      ).toEqual([]);
      expect(
        await alice.query(
          api.social.listIncomingFollowRequests.listIncomingFollowRequests,
          {},
        ),
      ).toEqual([]);
    },
  );

  test.each(DIRECTIONS)(
    "%s: followers-you-know leaves the other member out",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      // alice follows bob and carol, both follow dave: bob and carol are known followers of dave.
      const dave = await t.run((ctx) =>
        ctx.db.insert("users", {
          clerkId: "clerk_dave",
          email: "dave@example.com",
          name: "dave",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
      await follow(t, u.alice, u.bob);
      await follow(t, u.alice, u.carol);
      await follow(t, u.bob, dave);
      await follow(t, u.carol, dave);
      await insertBlock(t, ...pair(u));
      const alice = as(t, "alice");

      const known = await alice.query(
        api.social.followersYouKnow.followersYouKnow,
        { memberId: dave },
      );
      expect(known.total).toBe(1);
      expect(known.members.map((m) => m.memberId)).toEqual([u.carol]);
      // And nothing about the blocked member themself.
      expect(
        await alice.query(api.social.followersYouKnow.followersYouKnow, {
          memberId: u.bob,
        }),
      ).toEqual({ total: 0, members: [] });
    },
  );
});

describe("activity feed", () => {
  test.each(DIRECTIONS)(
    "%s: the other member's activity is dropped",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await follow(t, u.alice, u.bob);
      await t.run((ctx) =>
        ctx.db.insert("domainEvents", {
          name: "CompletionRecorded",
          payload: { userId: u.bob, completionId: "completion-1" },
          occurredAt: Date.now(),
          context: "solving",
        }),
      );
      const alice = as(t, "alice");
      const before = await alice.query(
        api.social.getActivityFeed.getActivityFeed,
        {},
      );
      expect(before.map((e) => e.memberId)).toEqual([u.bob]);

      await insertBlock(t, ...pair(u));
      expect(
        await alice.query(api.social.getActivityFeed.getActivityFeed, {}),
      ).toEqual([]);
    },
  );
});

describe("profile content", () => {
  test.each(DIRECTIONS)(
    "%s: profile copies, solves and the featured shelf are empty",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      // A copy alice holds: canViewCopy still passes for her, the profile lists must not.
      const copy = await seedOpenCopy(t, u.bob, { heldBy: u.alice });
      await t.run(async (ctx) => {
        await ctx.db.insert("profiles", {
          memberId: u.bob,
          visibility: "public",
          featuredCopyIds: [copy],
          updatedAt: Date.now(),
        });
        const puzzle = (await ctx.db.get(copy))!.puzzleId;
        await ctx.db.insert("completions", {
          userId: u.bob,
          puzzleId: puzzle,
          isCompleted: true,
          photos: [],
          startDate: Date.now(),
          endDate: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      const alice = as(t, "alice");
      const paginationOpts = { numItems: 10, cursor: null };
      const args = { memberId: u.bob, paginationOpts };
      expect(
        (
          await alice.query(
            api.social.listProfileCopies.listProfileCopies,
            args,
          )
        ).page,
      ).toHaveLength(1);
      expect(
        (
          await alice.query(
            api.social.listProfileCompletions.listProfileCompletions,
            args,
          )
        ).page,
      ).toHaveLength(1);
      expect(
        await alice.query(api.social.featuredShelf.featuredShelf, {
          userId: u.bob,
        }),
      ).toHaveLength(1);

      await insertBlock(t, ...pair(u));
      expect(
        (
          await alice.query(
            api.social.listProfileCopies.listProfileCopies,
            args,
          )
        ).page,
      ).toEqual([]);
      expect(
        (
          await alice.query(
            api.social.listProfileCompletions.listProfileCompletions,
            args,
          )
        ).page,
      ).toEqual([]);
      expect(
        await alice.query(api.social.featuredShelf.featuredShelf, {
          userId: u.bob,
        }),
      ).toEqual([]);
    },
  );
});

describe("comments and reviews", () => {
  test.each(DIRECTIONS)(
    "%s: the other member's comments and reviews are filtered",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      // carol's copy, so the copy gate itself is unaffected by the block.
      const copy = await seedOpenCopy(t, u.carol);
      const { puzzleId, photoId } = await t.run(async (ctx) => {
        const now = Date.now();
        const puzzleId = (await ctx.db.get(copy))!.puzzleId;
        const photoId = await ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId: u.carol,
          fileId: await ctx.storage.store(new Blob(["x"])),
          createdAt: now,
          updatedAt: now,
        });
        for (const authorId of [u.bob, u.carol]) {
          await ctx.db.insert("puzzleComments", {
            puzzleId,
            copyId: copy,
            authorId,
            text: "nice",
            createdAt: now,
          });
          await ctx.db.insert("photoComments", {
            photoId,
            authorId,
            text: "nice",
            createdAt: now,
          });
          await ctx.db.insert("puzzleReviews", {
            userId: authorId,
            puzzleId,
            rating: 5,
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.insert("profiles", {
            memberId: authorId,
            visibility: "public",
            updatedAt: now,
          });
        }
        return { puzzleId, photoId };
      });
      await insertBlock(t, ...pair(u));
      const alice = as(t, "alice");

      const comments = await alice.query(
        api.social.listPuzzleComments.listPuzzleComments,
        { copyId: copy },
      );
      expect(comments.map((c) => c.author._id)).toEqual([u.carol]);
      const photoComments = await alice.query(
        api.library.listPhotoComments.listPhotoComments,
        { photoId },
      );
      expect(photoComments.map((c) => c.author._id)).toEqual([u.carol]);
      const reviews = await alice.query(
        api.social.listPuzzleReviews.listPuzzleReviews,
        { puzzleId },
      );
      expect(reviews.map((r) => r.author._id)).toEqual([u.carol]);
      // Public reviews: filtered when signed in, untouched for an anonymous visitor.
      expect(
        await alice.query(
          api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
          { puzzleId },
        ),
      ).toHaveLength(1);
      expect(
        await t.query(
          api.social.listPublicPuzzleReviews.listPublicPuzzleReviews,
          { puzzleId },
        ),
      ).toHaveLength(2);
    },
  );
});

describe("search", () => {
  test.each(DIRECTIONS)(
    "%s: people search, global search, recent members and browse exclude the other member",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const bobCopy = await seedOpenCopy(t, u.bob);
      await seedOpenCopy(t, u.carol);
      await insertBlock(t, ...pair(u));
      const alice = as(t, "alice");

      const people = await alice.query(api.identity.searchUsers.searchUsers, {
        searchTerm: "puzzler",
      });
      expect(people.map((p) => p._id).sort()).toEqual(
        [u.alice, u.carol].sort(),
      );
      const global = await alice.query(api.search.globalSearch.global, {
        term: "puzzler",
      });
      expect(global.people.map((p) => p.id)).toEqual([u.carol]);
      const recent = await alice.query(
        api.identity.listRecentPublicMembers.listRecentPublicMembers,
        {},
      );
      expect(recent.map((m) => m._id)).toEqual([u.carol]);
      const browse = await alice.query(
        api.library.browseOwnedPuzzles.browseOwnedPuzzles,
        {},
      );
      const owners = browse.ownedPuzzles.map((c) => c._id);
      expect(owners).not.toContain(bobCopy);
      expect(owners).toHaveLength(1);
    },
  );
});

describe("households and circles", () => {
  test.each(DIRECTIONS)(
    "%s: a household invite is refused as a missing member",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await as(t, "alice").mutation(
        api.household.createHousehold.createHousehold,
        {},
      );
      await insertBlock(t, ...pair(u));
      await expectCode(
        as(t, "alice").mutation(
          api.household.inviteToHousehold.inviteToHousehold,
          { inviteeId: u.bob },
        ),
        "MemberNotFound",
      );
    },
  );

  test.each(DIRECTIONS)(
    "%s: accepting an earlier invite is refused as a missing invite",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await as(t, "alice").mutation(
        api.household.createHousehold.createHousehold,
        {},
      );
      const inviteId = await as(t, "alice").mutation(
        api.household.inviteToHousehold.inviteToHousehold,
        { inviteeId: u.bob },
      );
      await insertBlock(t, ...pair(u));
      await expectCode(
        as(t, "bob").mutation(
          api.household.acceptHouseholdInvite.acceptHouseholdInvite,
          { inviteId },
        ),
        "InviteNotFound",
      );
    },
  );

  test.each(DIRECTIONS)(
    "%s: a household link from the other member reads as invalid",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const householdId = await as(t, "alice").mutation(
        api.household.createHousehold.createHousehold,
        {},
      );
      const now = Date.now();
      await t.run((ctx) =>
        ctx.db.insert("inviteLinks", {
          ownerId: u.alice,
          token: "hh-token",
          createdAt: now,
          landingViews: 0,
          signupsAttributed: 0,
          followsEstablished: 0,
          context: { kind: "household", householdId },
          expiresAt: now + 60_000,
        }),
      );
      const state = () =>
        t.run(
          async (ctx) =>
            (await resolveHouseholdLink(ctx, "hh-token", u.bob, now)).state,
        );
      expect(await state()).toBe("can-accept");
      await insertBlock(t, ...pair(u));
      expect(await state()).toBe("invalid");
      await expectCode(
        as(t, "bob").mutation(
          api.social.acceptHouseholdLinkInvite.acceptHouseholdLinkInvite,
          { token: "hh-token" },
        ),
        "InviteLinkInvalid",
      );
    },
  );

  test.each(DIRECTIONS)(
    "%s: adding the other member to a circle is refused",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const circleId = await as(t, "alice").mutation(
        api.sharing.createCircle.createCircle,
        { name: "Puzzlers" },
      );
      await insertBlock(t, ...pair(u));
      await expectCode(
        as(t, "alice").mutation(api.sharing.addMember.addMember, {
          circleId,
          memberId: u.bob,
          permission: "ViewOnly",
        }),
        "NotCircleAdmin",
      );
      // An unblocked member can still be added.
      await as(t, "alice").mutation(api.sharing.addMember.addMember, {
        circleId,
        memberId: u.carol,
        permission: "ViewOnly",
      });
    },
  );
});

describe("notifications", () => {
  // A follow edge that predates the block: replaying its MemberFollowed event must not notify.
  const replayFollow = (
    t: T,
    followerId: Id<"users">,
    followeeId: Id<"users">,
  ) =>
    t.run(async (ctx) => {
      const eventId = await ctx.db.insert("domainEvents", {
        name: "MemberFollowed",
        payload: { followerId, followeeId },
        occurredAt: Date.now(),
        context: "social",
      });
      await handleDomainEvent(
        ctx,
        (await ctx.db.get(eventId)) as Doc<"domainEvents">,
      );
      return (
        await ctx.db
          .query("notifications")
          .filter((q) => q.eq(q.field("userId"), followeeId))
          .collect()
      ).filter((n) => n.type === "new_follower");
    });

  test("a notification from an unblocked actor is created", async () => {
    const t = convexTest(schema, modules);
    const u = await seed(t);
    await follow(t, u.bob, u.alice);
    expect((await replayFollow(t, u.bob, u.alice)).length).toBeGreaterThan(0);
  });

  test.each(DIRECTIONS)(
    "%s: a notification from the other member is not created",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await follow(t, u.bob, u.alice);
      await insertBlock(t, ...pair(u));
      expect(await replayFollow(t, u.bob, u.alice)).toEqual([]);
    },
  );
  test.each(DIRECTIONS)(
    "%s: an invite-link connection offer (#197) is not notified",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await insertBlock(t, ...pair(u));
      const offered = await t.run(async (ctx) => {
        const eventId = await ctx.db.insert("domainEvents", {
          name: "ConnectionOffered",
          payload: { offerId: "offer-1", fromId: u.bob, toId: u.alice },
          occurredAt: Date.now(),
          context: "social",
        });
        await handleDomainEvent(
          ctx,
          (await ctx.db.get(eventId)) as Doc<"domainEvents">,
        );
        return (
          await ctx.db
            .query("notifications")
            .filter((q) => q.eq(q.field("userId"), u.alice))
            .collect()
        ).filter((n) => n.type === "connection_offer_received");
      });
      expect(offered).toEqual([]);
    },
  );

  test.each(DIRECTIONS)(
    "%s: a pending connection offer drops out of the recipient's list",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      await t.run((ctx) =>
        ctx.db.insert("connectionOffers", {
          aggregateId: "offer-1",
          fromId: u.bob,
          toId: u.alice,
          source: "inviteLink",
          status: "pending",
          createdAt: Date.now(),
          expiresAt: Date.now() + 86_400_000,
        }),
      );
      const list = () =>
        as(t, "alice").query(
          api.social.listMyConnectionOffers.listMyConnectionOffers,
          {},
        );
      expect(await list()).toHaveLength(1);
      await insertBlock(t, ...pair(u));
      expect(await list()).toEqual([]);
    },
  );

  test.each(DIRECTIONS)(
    "%s: a dispute on an accepted exchange still notifies, without the actor",
    async (_, pair) => {
      const t = convexTest(schema, modules);
      const u = await seed(t);
      const copy = await seedOpenCopy(t, u.alice);
      const exchangeId = await as(t, "bob").mutation(
        api.exchange.propose.propose,
        {
          recipientId: u.alice,
          type: "sale",
          requestedPuzzleId: copy,
          salePrice: 10,
        },
      );
      await as(t, "alice").mutation(api.exchange.accept.accept, {
        exchangeId,
      });
      await flushScheduled(t);
      await insertBlock(t, ...pair(u));

      await as(t, "bob").mutation(api.exchange.raiseDispute.raiseDispute, {
        exchangeId,
      });
      await flushScheduled(t);

      const disputed = await t.run(async (ctx) =>
        (
          await ctx.db
            .query("notifications")
            .filter((q) => q.eq(q.field("userId"), u.alice))
            .collect()
        ).filter((n) => n.type === "exchange_disputed"),
      );
      expect(disputed.length).toBeGreaterThan(0);
      for (const row of disputed) {
        expect(row.actorIds ?? []).toEqual([]);
      }
    },
  );
});

// Drain the async event dispatcher (lifecycle notifications come from a scheduled subscriber).
const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};
