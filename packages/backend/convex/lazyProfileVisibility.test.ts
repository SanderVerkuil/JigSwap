import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { quickStartFactsOf } from "./onboarding/quickStartFacts";
import schema from "./schema";
import { projectPublicAuthor } from "./social/privacy";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type Seeded = { frank: Id<"users">; copyId: Id<"ownedPuzzles"> };

// Frank never chose a visibility: no profiles row, a location, an avatar he shares publicly, and
// one owned copy to feature on his shelf.
const seedFrank = (t: TestConvex<typeof schema>): Promise<Seeded> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const frank = await ctx.db.insert("users", {
      clerkId: "clerk_frank",
      email: "frank@example.com",
      name: "Frank",
      username: "frank",
      location: "Rotterdam",
      avatar: "https://img.example/frank.png",
      shareAvatarPublicly: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Frank's Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: frank,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: frank,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    return { frank, copyId };
  });

const asFrank = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_frank" });

const profileRowOf = (t: TestConvex<typeof schema>, frank: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", frank))
      .unique(),
  );

// Every way a member gets a profiles row without choosing a visibility (SEC-44: only an explicit
// public choice opens the logged-out page), including a legacy row written before visibility.
const openers: Array<
  [string, (t: TestConvex<typeof schema>, seeded: Seeded) => Promise<unknown>]
> = [
  [
    "a bio edit",
    (t) =>
      asFrank(t).mutation(api.social.editProfile.editProfile, {
        bio: "hello",
      }),
  ],
  [
    "arranging the shelf",
    (t, { copyId }) =>
      asFrank(t).mutation(api.social.arrangeShelf.arrangeShelf, {
        copyIds: [copyId],
      }),
  ],
  [
    "arranging an empty shelf",
    (t) =>
      asFrank(t).mutation(api.social.arrangeShelf.arrangeShelf, {
        copyIds: [],
      }),
  ],
  [
    "an edit of a legacy row without visibility",
    async (t, { frank }) => {
      await t.run((ctx) =>
        ctx.db.insert("profiles", {
          aggregateId: "profile-legacy-frank",
          memberId: frank,
          bio: "old",
          updatedAt: Date.now(),
        }),
      );
      await asFrank(t).mutation(api.social.editProfile.editProfile, {
        bio: "new",
      });
    },
  ],
];

describe.each(openers)("a profile row opened by %s", (_, open) => {
  test("stores no visibility: logged out stays locked, in-app still reads public", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedFrank(t);
    await open(t, seeded);

    const row = await profileRowOf(t, seeded.frank);
    expect(row).not.toBeNull();
    expect(row?.visibility).toBeUndefined();

    const anonymous = await t.query(
      api.social.getPublicProfile.getPublicProfile,
      { handle: "frank" },
    );
    expect(anonymous?.locked).toBe(true);
    expect(anonymous?.hero.visibility).toBe("private");
    expect(anonymous?.hero.location).toBeUndefined();
    expect(JSON.stringify(anonymous)).not.toContain("Rotterdam");

    const own = await asFrank(t).query(api.social.getProfile.getProfile, {});
    expect(own?.visibility).toBe("public");
  });

  test("public review authors, landing avatars and the quick start treat it as unchosen", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedFrank(t);
    await open(t, seeded);

    const { author, facts } = await t.run(async (ctx) => {
      const user = await ctx.db.get(seeded.frank);
      if (!user) throw new Error("seeded user missing");
      return {
        author: await projectPublicAuthor(ctx, seeded.frank),
        facts: await quickStartFactsOf(ctx, user),
      };
    });
    expect(author).toBeNull();
    expect(facts.visibilitySet).toBe(false);

    const avatars = await t.query(
      api.insights.getCommunityAvatars.getCommunityAvatars,
      { limit: 10, seed: 1 },
    );
    expect(avatars).toEqual([]);
  });
});

test("an explicit public choice after a lazy row still opens the logged-out page", async () => {
  const t = convexTest(schema, modules);
  const { frank } = await seedFrank(t);
  await asFrank(t).mutation(api.social.editProfile.editProfile, {
    bio: "hello",
  });
  await asFrank(t).mutation(
    api.social.setProfileVisibility.setProfileVisibility,
    { visibility: "public" },
  );

  expect((await profileRowOf(t, frank))?.visibility).toBe("public");
  const anonymous = await t.query(
    api.social.getPublicProfile.getPublicProfile,
    { handle: "frank" },
  );
  expect(anonymous?.locked).toBe(false);
  expect(anonymous?.hero.location).toBe("Rotterdam");
});
