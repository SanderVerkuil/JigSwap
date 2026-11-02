import { convexTest, type TestConvex } from "convex-test";
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

// An explicit public profile choice: logged-out reads treat a missing row as private (SEC-44).
const choosePublic = (t: TestConvex<typeof schema>, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("profiles", {
      memberId,
      visibility: "public",
      updatedAt: Date.now(),
    }),
  );

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
    const { cast } = await seedTwo(t);
    await choosePublic(t, cast.alice);
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
    await choosePublic(t, cast.alice);
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

describe("rule P: the other party of an exchange may see a private copy", () => {
  const STATUSES = [
    ["proposed", true],
    ["accepted", true],
    ["completed", true],
    ["disputed", true],
    ["rejected", false],
    ["cancelled", false],
  ] as const;

  // `side` is where alice's private copy sits: offered by alice to frank, or requested by frank.
  const seedExchange = async (
    t: TestConvex<typeof schema>,
    side: "offered" | "requested",
    status: Doc<"exchanges">["status"],
  ) => {
    const cast = await seedCast(t);
    const copy = await t.run(async (ctx) => {
      const privateCopy = await insertCopy(ctx, cast, PRIVATE);
      const franksCopy = await insertCopy(ctx, cast, {
        ownerId: cast.frank,
        availability: { ...CLOSED, forTrade: true },
      });
      await ctx.db.insert("exchanges", {
        aggregateId: crypto.randomUUID(),
        type: "trade",
        status,
        ...(side === "offered"
          ? {
              initiatorId: cast.alice,
              recipientId: cast.frank,
              offeredPuzzleId: privateCopy,
              requestedPuzzleId: franksCopy,
            }
          : {
              initiatorId: cast.frank,
              recipientId: cast.alice,
              offeredPuzzleId: franksCopy,
              requestedPuzzleId: privateCopy,
            }),
        createdAt: NOW,
        updatedAt: NOW,
      });
      return privateCopy;
    });
    return { cast, copy };
  };

  for (const side of ["offered", "requested"] as const) {
    test.each(STATUSES)(
      `${side} side, %s -> counterparty sees it: %s; third parties never`,
      async (status, visible) => {
        const t = convexTest(schema, modules);
        const { copy } = await seedExchange(t, side, status);
        const view = await viewCopy(t, "frank", copy);
        expect(view !== null).toBe(visible);
        if (view) expect(view.snapshot.visibility).toBe("private");
        // The mutual follower and a stranger are not parties.
        expect(await viewCopy(t, "bob", copy)).toBeNull();
        expect(await viewCopy(t, "erin", copy)).toBeNull();
      },
    );
  }
});

describe("an offer keeps the owner's private choice (UX-20)", () => {
  // Drain the async dispatch chain (settle -> PossessionTransferred -> openLoan ...).
  const flush = async (t: TestConvex<typeof schema>) => {
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }
  };

  // Alice acquires a copy and makes it private; returns its aggregateId and row _id.
  const privateCopy = async (t: TestConvex<typeof schema>, cast: Cast) => {
    const copyId = await as(t, "alice").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: cast.puzzleAggregateId, condition: "good" },
    );
    await as(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "private" },
    );
    const row = await rowOf(t, copyId);
    if (!row) throw new Error("setup: copy row missing");
    return { copyId, rowId: row._id };
  };

  const rowOf = (t: TestConvex<typeof schema>, copyId: string) =>
    t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );

  // Offer toggles from the copy page send only the flags, never a visibility.
  const offer = (
    t: TestConvex<typeof schema>,
    copyId: string,
    flags: Partial<typeof CLOSED>,
  ) =>
    as(t, "alice").mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId,
      ...flags,
    });

  test.each([{ forTrade: true }, { forSale: true }, { forLend: true }])(
    "offering a private copy (%o) shows it to others while offered and keeps the stored choice private",
    async (flags) => {
      const t = convexTest(schema, modules);
      const cast = await seedCast(t);
      const { copyId, rowId } = await privateCopy(t, cast);

      await offer(t, copyId, flags);

      const row = await rowOf(t, copyId);
      expect(row?.availability).toEqual({ ...CLOSED, ...flags });
      expect(row?.visibility).toBe("private");
      expect(row?.visibilityAuthoritative).toBe(true);
      expect(row && effectiveCopyVisibility(row)).toBe("visible");
      for (const name of ["bob", "erin", "frank"]) {
        const view = await viewCopy(t, name, rowId);
        expect(view).not.toBeNull();
        expect(view?.snapshot.visibility).toBe("visible");
      }
    },
  );

  test("withdrawing without a visibility makes the copy private again", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forTrade: true });

    await offer(t, copyId, {});

    const row = await rowOf(t, copyId);
    expect(row?.availability).toEqual(CLOSED);
    expect(row?.visibility).toBe("private");
    for (const name of ["bob", "erin", "frank"]) {
      expect(await viewCopy(t, name, rowId)).toBeNull();
    }
    expect((await viewCopy(t, "alice", rowId))?.snapshot.visibility).toBe(
      "private",
    );
  });

  test("an explicit visibility still replaces the choice", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forLend: true });

    await as(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible" },
    );

    expect((await rowOf(t, copyId))?.visibility).toBe("visible");
    expect(await viewCopy(t, "bob", rowId)).not.toBeNull();
  });

  test("changing the condition while offered keeps the private choice", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forTrade: true });

    await as(t, "alice").mutation(
      api.library.changeCopyCondition.changeCopyCondition,
      { copyId, condition: "fair" },
    );
    const row = await rowOf(t, copyId);
    expect(row?.condition).toBe("fair");
    expect(row?.visibility).toBe("private");

    await offer(t, copyId, {});
    expect(await viewCopy(t, "bob", rowId)).toBeNull();
  });

  test("a settled lend of an offered private copy leaves it private: only the borrower and household see it", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forLend: true });

    const exchangeId = await as(t, "frank").mutation(
      api.exchange.propose.propose,
      { recipientId: cast.alice, type: "loan", requestedPuzzleId: rowId },
    );
    await as(t, "alice").mutation(api.exchange.accept.accept, { exchangeId });
    for (const name of ["frank", "alice"]) {
      await as(t, name).mutation(
        api.exchange.confirmCompletion.confirmCompletion,
        { exchangeId },
      );
    }
    await flush(t);

    const row = await rowOf(t, copyId);
    expect(row?.heldBy).toBe(cast.frank);
    expect(row?.availability).toEqual(CLOSED);
    expect(row && effectiveCopyVisibility(row)).toBe("private");
    for (const name of ["alice", "dave", "frank"]) {
      expect(await viewCopy(t, name, rowId)).not.toBeNull();
    }
    for (const name of ["bob", "erin"]) {
      expect(await viewCopy(t, name, rowId)).toBeNull();
    }
  });

  test("getCopyInstanceView carries visibilityPreference to managers only", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forTrade: true });

    const preferenceFor = async (name: string) =>
      (await viewCopy(t, name, rowId))?.snapshot.visibilityPreference;
    expect(await preferenceFor("alice")).toBe("private");
    // dave is alice's household mate; the copy's default household permission is "manage".
    expect(await preferenceFor("dave")).toBe("private");
    for (const name of ["bob", "erin", "frank"]) {
      const view = await viewCopy(t, name, rowId);
      expect(view).not.toBeNull();
      expect(view?.snapshot.visibilityPreference).toBeUndefined();
    }

    await t.run((ctx) => ctx.db.patch(rowId, { householdPermission: "view" }));
    const viewOnly = await viewCopy(t, "dave", rowId);
    expect(viewOnly?.viewerCanManage).toBe(false);
    expect(viewOnly?.snapshot.visibilityPreference).toBeUndefined();
  });

  test("getCopyInstanceView tells managers, and only them, how far an offer reaches", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { rowId } = await t.run(async (ctx) => ({
      rowId: await insertCopy(ctx, cast, {
        ...VISIBLE,
        availability: { ...CLOSED, forTrade: true },
      }),
    }));
    const reachFor = async (name: string) =>
      (await viewCopy(t, name, rowId))?.snapshot.ownerProfileVisibility;

    // No profile row reads as public, as canViewCopy's rule 3 does.
    expect(await reachFor("alice")).toBe("public");
    await t.run((ctx) =>
      ctx.db.insert("profiles", {
        memberId: cast.alice,
        visibility: "private",
        updatedAt: NOW,
      }),
    );
    expect(await reachFor("alice")).toBe("private");
    // It describes the owner, whoever manages the copy.
    expect(await reachFor("dave")).toBe("private");
    const friend = await viewCopy(t, "bob", rowId);
    expect(friend).not.toBeNull();
    expect(friend?.snapshot.ownerProfileVisibility).toBeUndefined();

    await t.run((ctx) => ctx.db.patch(rowId, { householdPermission: "view" }));
    const viewOnly = await viewCopy(t, "dave", rowId);
    expect(viewOnly?.viewerCanManage).toBe(false);
    expect(viewOnly?.snapshot.ownerProfileVisibility).toBeUndefined();
  });

  test("a library row carries visibilityPreference to managers only", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    await choosePublic(t, cast.alice);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forTrade: true });

    const rowFor = async (name: string) =>
      (
        await as(t, name).query(
          api.library.listMyLibraryWindow.listMyLibraryWindow,
          { limit: 10 },
        )
      ).rows.find((row) => row._id === rowId);
    // Offered, so the effective value says "visible": the row must also say what the owner chose.
    const own = await rowFor("alice");
    expect(own?.visibility).toBe("visible");
    expect(own?.visibilityPreference).toBe("private");
    expect((await rowFor("dave"))?.visibilityPreference).toBe("private");

    await t.run((ctx) => ctx.db.patch(rowId, { householdPermission: "view" }));
    const viewOnly = await rowFor("dave");
    expect(viewOnly).toBeDefined();
    expect(viewOnly?.visibilityPreference).toBeUndefined();

    // The public projection never carries it, not even to the owner on their own profile.
    const profile = await as(t, "alice").query(
      api.social.listProfileCopies.listProfileCopies,
      {
        memberId: cast.alice,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    const onProfile = profile.page.find((copy) => copy._id === rowId);
    expect(onProfile).toBeDefined();
    expect(onProfile).not.toHaveProperty("visibilityPreference");
  });

  test("visibilityPreference falls back to the effective value for unmarked and visible rows", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { legacy, visible, privateClosed } = await t.run(async (ctx) => ({
      legacy: await insertCopy(ctx, cast, {
        aggregateId: "legacy-copy",
        visibility: "private",
      }),
      visible: await insertCopy(ctx, cast, {
        aggregateId: "visible-copy",
        ...VISIBLE,
      }),
      privateClosed: await insertCopy(ctx, cast, {
        aggregateId: "private-copy",
        ...PRIVATE,
      }),
    }));
    const preferenceOf = async (rowId: Id<"ownedPuzzles">) =>
      (await viewCopy(t, "alice", rowId))?.snapshot.visibilityPreference;
    expect(await preferenceOf(legacy)).toBe("visible");
    expect(await preferenceOf(visible)).toBe("visible");
    expect(await preferenceOf(privateClosed)).toBe("private");

    // Offering the legacy row through the domain stamps the marker with "visible", not the old
    // untrusted stored "private".
    await offer(t, "legacy-copy", { forTrade: true });
    await offer(t, "legacy-copy", {});
    expect(await viewCopy(t, "bob", legacy)).not.toBeNull();
  });

  test("an exchange party sees the offered copy's effective visibility, never the owner's choice", async () => {
    const t = convexTest(schema, modules);
    const cast = await seedCast(t);
    const { copyId, rowId } = await privateCopy(t, cast);
    await offer(t, copyId, { forLend: true });

    const aggregateId = await as(t, "frank").mutation(
      api.exchange.propose.propose,
      { recipientId: cast.alice, type: "loan", requestedPuzzleId: rowId },
    );
    const exchange = await t.run((ctx) =>
      ctx.db
        .query("exchanges")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
        .unique(),
    );
    if (!exchange) throw new Error("setup: exchange row missing");
    const view = await as(t, "frank").query(
      api.exchange.getExchangeById.getExchangeById,
      { exchangeId: exchange._id },
    );
    expect(view?.ownerPuzzle?._id).toBe(rowId);
    expect(view?.ownerPuzzle?.visibility).toBe("visible");
  });
});
