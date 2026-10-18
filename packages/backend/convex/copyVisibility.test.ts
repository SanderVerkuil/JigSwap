import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { effectiveCopyVisibility } from "./library/copyVisibility";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The per-copy visibility toggle: a PRIVATE copy (effectiveCopyVisibility) is visible only to its
// owner, its current holder and the owner's household — never to mutual followers or anyone else —
// and is left out of every count shown to them. Legacy rows (no `visibilityAuthoritative` marker)
// read as visible whatever they store, so nothing changes before the backfill has run.

const NOW = 1_700_000_000_000;
const CLOSED = { forTrade: false, forSale: false, forLend: false };

type Cast = {
  alice: Id<"users">; // the owner
  bob: Id<"users">; // mutual follower of alice
  carol: Id<"users">; // currently holds alice's copy (a borrower)
  dave: Id<"users">; // alice's household mate
  erin: Id<"users">; // follows alice one-way
  frank: Id<"users">; // stranger
  puzzle: Id<"puzzles">;
  puzzleAggregateId: string;
};

const as = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });

const seedCast = (t: TestConvex<typeof schema>): Promise<Cast> =>
  t.run(async (ctx) => {
    const mk = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        username: name,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const alice = await mk("alice");
    const bob = await mk("bob");
    const carol = await mk("carol");
    const dave = await mk("dave");
    const erin = await mk("erin");
    const frank = await mk("frank");
    const follow = (followerId: Id<"users">, followeeId: Id<"users">) =>
      ctx.db.insert("follows", { followerId, followeeId, createdAt: NOW });
    await follow(bob, alice);
    await follow(alice, bob);
    await follow(erin, alice);
    for (const memberId of [alice, dave]) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh-1",
        memberId,
        role: "member",
        joinedAt: NOW,
      });
    }
    const puzzleAggregateId = "def-1";
    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Secret Garden",
      pieceCount: 1000,
      status: "approved",
      submittedBy: frank,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return {
      alice,
      bob,
      carol,
      dave,
      erin,
      frank,
      puzzle,
      puzzleAggregateId,
    };
  });

const insertCopy = (
  ctx: MutationCtx,
  cast: Cast,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  ctx.db.insert("ownedPuzzles", {
    aggregateId: crypto.randomUUID(),
    puzzleId: cast.puzzle,
    puzzleDefinitionId: cast.puzzleAggregateId,
    ownerId: cast.alice,
    condition: "good",
    availability: CLOSED,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });

const PRIVATE = {
  visibility: "private",
  visibilityAuthoritative: true,
} as const;
const VISIBLE = {
  visibility: "visible",
  visibilityAuthoritative: true,
} as const;

const viewCopy = (
  t: TestConvex<typeof schema>,
  name: string,
  copyId: Id<"ownedPuzzles">,
) =>
  as(t, name).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId,
  });

describe("effectiveCopyVisibility", () => {
  test.each([
    [{ availability: CLOSED }, "visible"],
    [{ availability: CLOSED, visibility: "private" }, "visible"],
    [{ availability: CLOSED, ...PRIVATE }, "private"],
    [{ availability: CLOSED, ...VISIBLE }, "visible"],
    [{ availability: CLOSED, visibilityAuthoritative: true }, "visible"],
    [{ availability: { ...CLOSED, forLend: true }, ...PRIVATE }, "visible"],
    [{ availability: { ...CLOSED, forSale: true }, ...PRIVATE }, "visible"],
    [{ availability: { ...CLOSED, forTrade: true }, ...PRIVATE }, "visible"],
  ] as const)("%o -> %s", (row, expected) => {
    expect(effectiveCopyVisibility(row)).toBe(expected);
  });
});

describe("canViewCopy honours a private copy (via getCopyInstanceView)", () => {
  test("private + marker, not offered: owner, holder and household yes; mutual, one-way, stranger no", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const copy = await t.run((ctx) =>
      insertCopy(ctx, cast, { ...PRIVATE, heldBy: cast.carol }),
    );

    for (const name of ["alice", "carol", "dave"]) {
      expect(await viewCopy(t, name, copy)).not.toBeNull();
    }
    for (const name of ["bob", "erin", "frank"]) {
      expect(await viewCopy(t, name, copy)).toBeNull();
    }
    expect((await viewCopy(t, "alice", copy))?.snapshot.visibility).toBe(
      "private",
    );
  });

  test("the same copy marked visible is reachable for the mutual follower again", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const copy = await t.run((ctx) => insertCopy(ctx, cast, VISIBLE));
    const view = await viewCopy(t, "bob", copy);
    expect(view).not.toBeNull();
    expect(view?.snapshot.visibility).toBe("visible");
    // Still closed, so one-way followers and strangers can't reach it (unchanged rules).
    expect(await viewCopy(t, "erin", copy)).toBeNull();
  });

  test("a LEGACY row (stored private, no marker) reads as visible — no deploy-order dependency", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const legacy = await t.run((ctx) =>
      insertCopy(ctx, cast, { visibility: "private" }),
    );
    const view = await viewCopy(t, "bob", legacy);
    expect(view).not.toBeNull();
    expect(view?.snapshot.visibility).toBe("visible");
  });

  test("an OPEN copy stored private+marker still follows the open rules (public owner -> anyone)", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const copy = await t.run((ctx) =>
      insertCopy(ctx, cast, {
        ...PRIVATE,
        availability: { ...CLOSED, forLend: true },
      }),
    );
    for (const name of ["bob", "erin", "frank"]) {
      const view = await viewCopy(t, name, copy);
      expect(view).not.toBeNull();
      expect(view?.snapshot.visibility).toBe("visible");
    }
  });
});

describe("profile listings and counts drop private copies for non-household viewers", () => {
  const seedTwo = async (t: TestConvex<typeof schema>) => {
    const cast = await seedCast(t);
    const ids = await t.run(async (ctx) => ({
      hidden: await insertCopy(ctx, cast, PRIVATE),
      shown: await insertCopy(ctx, cast, VISIBLE),
      legacy: await insertCopy(ctx, cast, { visibility: "private" }),
    }));
    return { cast, ...ids };
  };

  const listAll = async (
    t: TestConvex<typeof schema>,
    viewer: string,
    memberId: Id<"users">,
  ) =>
    (
      await as(t, viewer).query(
        api.social.listProfileCopies.listProfileCopies,
        {
          memberId,
          paginationOpts: { numItems: 20, cursor: null },
          filter: "all",
        },
      )
    ).page.map((c) => c._id);

  test("listProfileCopies: the mutual follower's 'all' excludes the private copy; self and household include it", async () => {
    const t = convexTest(schema, modules);
    const { cast, hidden, shown, legacy } = await seedTwo(t);

    expect((await listAll(t, "bob", cast.alice)).sort()).toEqual(
      [shown, legacy].sort(),
    );
    for (const viewer of ["alice", "dave"]) {
      expect((await listAll(t, viewer, cast.alice)).sort()).toEqual(
        [hidden, shown, legacy].sort(),
      );
    }
    const self = await as(t, "alice").query(
      api.social.listProfileCopies.listProfileCopies,
      {
        memberId: cast.alice,
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(self.page.find((c) => c._id === hidden)?.visibility).toBe("private");
    expect(self.page.find((c) => c._id === legacy)?.visibility).toBe("visible");
  });

  test("getPublicProfile stats.puzzlesOwned excludes private copies for non-self/household viewers", async () => {
    const t = convexTest(schema, modules);
    await seedTwo(t);
    const owned = async (viewer: string | null) => {
      const query = viewer ? as(t, viewer) : t;
      const view = await query.query(
        api.social.getPublicProfile.getPublicProfile,
        { handle: "alice" },
      );
      return view && !view.locked ? view.stats.puzzlesOwned : null;
    };
    expect(await owned(null)).toBe(2);
    expect(await owned("bob")).toBe(2);
    expect(await owned("frank")).toBe(2);
    expect(await owned("alice")).toBe(3);
    expect(await owned("dave")).toBe(3);
  });

  test("getPublicMemberTeaser puzzleCount and getUserStats exclude private copies for others", async () => {
    const t = convexTest(schema, modules);
    const { cast } = await seedTwo(t);
    const teaser = api.social.getPublicMemberTeaser.getPublicMemberTeaser;
    const args = { handle: "alice" };
    expect((await t.query(teaser, args))?.puzzleCount).toBe(2);
    expect((await as(t, "bob").query(teaser, args))?.puzzleCount).toBe(2);
    expect((await as(t, "alice").query(teaser, args))?.puzzleCount).toBe(3);
    expect((await as(t, "dave").query(teaser, args))?.puzzleCount).toBe(3);

    const stats = (viewer: string) =>
      as(t, viewer).query(api.identity.getUserStats.getUserStats, {
        userId: cast.alice,
      });
    expect((await stats("bob"))?.puzzlesOwned).toBe(2);
    expect((await stats("dave"))?.puzzlesOwned).toBe(3);
  });
});

describe("activity feed hides a private copy's acquisition", () => {
  test("single entry hidden from the mutual follower; batch count excludes the private copy", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const defs = await t.run(async (ctx) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const aggregateId = `def-batch-${i}`;
        await ctx.db.insert("puzzles", {
          aggregateId,
          title: `Batch ${i}`,
          pieceCount: 500,
          status: "approved",
          submittedBy: cast.frank,
          createdAt: NOW,
          updatedAt: NOW,
        });
        out.push(aggregateId);
      }
      return out;
    });
    const alice = as(t, "alice");
    const { copyIds } = await alice.mutation(
      api.library.acquireCopies.acquireCopies,
      { items: defs.map((puzzleDefinitionId) => ({ puzzleDefinitionId })) },
    );
    const single = await alice.mutation(api.library.acquireCopy.acquireCopy, {
      puzzleDefinitionId: cast.puzzleAggregateId,
      condition: "good",
    });

    const feed = () =>
      as(t, "bob").query(api.social.getActivityFeed.getActivityFeed, {});
    const before = await feed();
    expect(before.find((e) => e.kind === "acquisition")?.ref).toBe(single);
    expect(
      before.find((e) => e.kind === "acquisitionBatch")?.batch?.count,
    ).toBe(3);

    for (const copyId of [single, copyIds[0]]) {
      await alice.mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId,
        visibility: "private",
      });
    }
    const after = await feed();
    expect(after.find((e) => e.kind === "acquisition")).toBeUndefined();
    const batch = after.find((e) => e.kind === "acquisitionBatch");
    expect(batch?.batch?.count).toBe(2);
    expect(batch?.batch?.covers.map((c) => c.copyId)).not.toContain(copyIds[0]);
  });
});

describe("collections, definition aggregates and completion links", () => {
  test("a public collection hides its private copy and counts consistently", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { collectionId, hidden, shown } = await t.run(async (ctx) => {
      const hidden = await insertCopy(ctx, cast, PRIVATE);
      const shown = await insertCopy(ctx, cast, VISIBLE);
      const collectionId = await ctx.db.insert("collections", {
        aggregateId: "col-1",
        userId: cast.alice,
        name: "Shelf",
        visibility: "public",
        isDefault: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      for (const ownedPuzzleId of [hidden, shown]) {
        await ctx.db.insert("collectionMembers", {
          collectionId,
          ownedPuzzleId,
          addedAt: NOW,
        });
      }
      return { collectionId, hidden, shown };
    });

    const detail = (viewer: string) =>
      as(t, viewer).query(api.library.getCollectionById.getCollectionById, {
        collectionId,
      });
    const count = async (viewer: string) =>
      (
        await as(t, viewer).query(
          api.library.getUserCollections.getUserCollections,
          { userId: cast.alice },
        )
      ).find((c) => c._id === collectionId)?.puzzleCount;

    expect((await detail("bob"))?.puzzles.map((p) => p._id)).toEqual([shown]);
    expect(await count("bob")).toBe(1);
    expect((await detail("alice"))?.puzzles.map((p) => p._id).sort()).toEqual(
      [hidden, shown].sort(),
    );
    expect(await count("alice")).toBe(2);
    expect((await detail("dave"))?.puzzles).toHaveLength(2);
    expect(await count("dave")).toBe(2);
  });

  test("definition owner counts skip private copies except the viewer's own / household's", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    await t.run(async (ctx) => {
      await insertCopy(ctx, cast, PRIVATE); // alice, private
      await insertCopy(ctx, cast, { ownerId: cast.erin, ...VISIBLE });
      await insertCopy(ctx, cast, {
        ownerId: cast.frank,
        visibility: "private",
      }); // legacy
    });
    const owners = async (viewer: string) =>
      (
        await as(t, viewer).query(
          api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
          { puzzleId: cast.puzzle },
        )
      )?.stats.communityOwners;
    expect(await owners("bob")).toBe(2);
    expect(await owners("alice")).toBe(3);
    expect(await owners("dave")).toBe(3);

    const publicView = await t.query(
      api.catalog.getPublicDefinitionView.getPublicDefinitionView,
      { puzzleId: cast.puzzle },
    );
    expect(publicView?.stats.communityOwners).toBe(2);
  });

  test("a solve on a private copy still lists, but links to the definition, not the copy", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { hidden, shown } = await t.run(async (ctx) => {
      const hidden = await insertCopy(ctx, cast, PRIVATE);
      const shown = await insertCopy(ctx, cast, VISIBLE);
      for (const [i, ownedPuzzleId] of [hidden, shown].entries()) {
        await ctx.db.insert("completions", {
          userId: cast.alice,
          puzzleId: cast.puzzle,
          ownedPuzzleId,
          startDate: NOW - (i + 2) * 3_600_000,
          endDate: NOW - (i + 1) * 3_600_000,
          completionTimeMinutes: 60,
          photos: [],
          isCompleted: true,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
      return { hidden, shown };
    });
    const links = async (viewer: string) =>
      (
        await as(t, viewer).query(
          api.social.listProfileCompletions.listProfileCompletions,
          {
            memberId: cast.alice,
            paginationOpts: { numItems: 10, cursor: null },
          },
        )
      ).page.map((row) => row.link);

    const bobLinks = await links("bob");
    expect(bobLinks).toHaveLength(2);
    expect(bobLinks).toContainEqual({ kind: "copy", id: shown });
    expect(bobLinks).toContainEqual({ kind: "definition", id: cast.puzzle });
    expect(bobLinks).not.toContainEqual({ kind: "copy", id: hidden });

    expect(await links("dave")).toContainEqual({ kind: "copy", id: hidden });
  });
});

describe("writes: updateCopySharing and the repository marker", () => {
  const dataOf = (e: unknown) =>
    (e as ConvexError<{ code: string; message: string }>).data;

  test.each([{ forTrade: true }, { forSale: true }, { forLend: true }])(
    "a private setting with an offer (%o) is rejected with CopyMustBeVisibleToOffer",
    async (flags) => {
      const t = convexTest(schema, modules);
      const cast = await seedCast(t);
      const copyId = await as(t, "alice").mutation(
        api.library.acquireCopy.acquireCopy,
        { puzzleDefinitionId: cast.puzzleAggregateId, condition: "good" },
      );
      const attempt = as(t, "alice").mutation(
        api.library.updateCopySharing.updateCopySharing,
        { copyId, visibility: "private", ...flags },
      );
      await expect(attempt).rejects.toBeInstanceOf(ConvexError);
      await attempt.catch((e: unknown) =>
        expect(dataOf(e).code).toBe("CopyMustBeVisibleToOffer"),
      );
      const row = await t.run((ctx) =>
        ctx.db
          .query("ownedPuzzles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
          .unique(),
      );
      expect(row?.visibility).toBe("visible");
      expect(row?.availability).toEqual(CLOSED);
    },
  );

  test("making a copy private writes private + marker", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const copyId = await as(t, "alice").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: cast.puzzleAggregateId, condition: "good" },
    );
    await as(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "private" },
    );
    const row = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );
    expect(row?.visibility).toBe("private");
    expect(row?.visibilityAuthoritative).toBe(true);
  });

  test("saving a LEGACY stored-private row through the domain writes visible + marker (never resurrects private)", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const aggregateId = "legacy-copy";
    const rowId = await t.run((ctx) =>
      insertCopy(ctx, cast, { aggregateId, visibility: "private" }),
    );
    await as(t, "alice").mutation(
      api.library.changeCopyCondition.changeCopyCondition,
      { copyId: aggregateId, condition: "fair" },
    );
    const row = await t.run((ctx) => ctx.db.get(rowId));
    expect(row?.condition).toBe("fair");
    expect(row?.visibility).toBe("visible");
    expect(row?.visibilityAuthoritative).toBe(true);
  });
});
