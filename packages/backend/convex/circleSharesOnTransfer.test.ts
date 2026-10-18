import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { collectCircleSharedCopies } from "./library/circleSharedCopies";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const OPEN = { forTrade: false, forSale: true, forLend: true };

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });
const asAlice = (t: T) => as(t, "clerk_alice"); // A: old owner, owns circle C
const asMia = (t: T) => as(t, "clerk_mia"); // M: member of C
const asNoah = (t: T) => as(t, "clerk_noah"); // N: new owner, no relation to M

// The transfer + its follow-ups run in scheduled dispatches; yield then drain until the chain settles.
const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Alice is PUBLIC (so Noah can find and buy her open copy); Mia and Noah are PRIVATE, don't follow
// each other, share no circle and no household — the circle is Mia's only path to the copy.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const mia = await mkUser("clerk_mia");
    const noah = await mkUser("clerk_noah");
    for (const [memberId, visibility] of [
      [alice, "public"],
      [mia, "private"],
      [noah, "private"],
    ] as const) {
      await ctx.db.insert("profiles", {
        memberId,
        displayName: "Member",
        visibility,
        updatedAt: now,
      });
    }
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, mia, noah, puzzleId, puzzleAggregateId };
  });

// Seat a member in a circle directly (aggregate membership + lookup row), bypassing the mutation.
const seatInCircle = (t: T, circleId: string, memberId: Id<"users">) =>
  t.run(async (ctx) => {
    const circle = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .unique();
    if (!circle) throw new Error("seed: circle not found");
    await ctx.db.patch(circle._id, {
      memberships: [
        ...circle.memberships,
        {
          id: crypto.randomUUID(),
          memberId,
          permission: "ViewOnly" as const,
          joinedAt: Date.now(),
        },
      ],
    });
    await ctx.db.insert("circleMembers", {
      circleAggregateId: circleId,
      memberId,
    });
  });

const rowOf = (t: T, copyAggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyAggregateId))
      .unique();
    if (!row) throw new Error("seed: copy not found");
    return row;
  });

const sharesOf = (t: T, copyAggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("circleCopyShares")
      .withIndex("by_copy", (q) => q.eq("copyId", copyAggregateId))
      .collect(),
  );

// Noah buys the copy from Alice through the real exchange flow; settlement transfers ownership.
const settleSaleToNoah = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  alice: Id<"users">,
) => {
  const exchangeId = await asNoah(t).mutation(api.exchange.propose.propose, {
    recipientId: alice,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  await asAlice(t).mutation(api.exchange.accept.accept, { exchangeId });
  await asNoah(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });
  await asAlice(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });
  await flushScheduled(t);
};

// What Mia can reach of the copy: its instance page, Browse, and the definition page.
const miaReach = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  puzzleId: Id<"puzzles">,
) => {
  const instance = await asMia(t).query(
    api.library.getCopyInstanceView.getCopyInstanceView,
    { copyId: copy },
  );
  const browse = await asMia(t).query(
    api.library.browseOwnedPuzzles.browseOwnedPuzzles,
    {},
  );
  const definition = await asMia(t).query(
    api.library.getPuzzleDefinitionView.getPuzzleDefinitionView,
    { puzzleId },
  );
  return {
    instance,
    inBrowse: browse.ownedPuzzles.some((c) => c._id === copy),
    inDefinition: JSON.stringify(definition).includes(copy),
  };
};

describe("circle shares on ownership transfer", () => {
  test("a transferred copy is no longer reachable through the old owner's circle", async () => {
    const t = convexTest(schema, modules);
    const { alice, mia, noah, puzzleId, puzzleAggregateId } = await seed(t);

    const circleId = (await asAlice(t).mutation(
      api.sharing.createCircle.createCircle,
      { name: "Saturday Puzzlers" },
    )) as string;
    await seatInCircle(t, circleId, mia);

    const copyAggregateId = (await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;
    const copy = (await rowOf(t, copyAggregateId))._id;
    await t.run(async (ctx) => ctx.db.patch(copy, { availability: OPEN }));
    await asAlice(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId: copyAggregateId,
    });

    // Control: while Alice owns it, Mia reaches it (Alice is public + open, and it's circle-shared).
    const before = await miaReach(t, copy, puzzleId);
    expect(before.instance).not.toBeNull();
    expect(before.inBrowse).toBe(true);
    expect(before.inDefinition).toBe(true);
    expect(await sharesOf(t, copyAggregateId)).toHaveLength(1);

    await settleSaleToNoah(t, copy, alice);
    expect((await rowOf(t, copyAggregateId)).ownerId).toBe(noah);

    // Noah opens the copy he now owns (settlement flips it closed).
    await t.run(async (ctx) => ctx.db.patch(copy, { availability: OPEN }));

    const after = await miaReach(t, copy, puzzleId);
    expect(after.instance).toBeNull();
    expect(after.inBrowse).toBe(false);
    expect(after.inDefinition).toBe(false);
    expect(await sharesOf(t, copyAggregateId)).toEqual([]);
  });

  test("shares go even when the new owner is in the same circle (they never chose to share it)", async () => {
    const t = convexTest(schema, modules);
    const { alice, mia, noah, puzzleId, puzzleAggregateId } = await seed(t);

    const circleId = (await asAlice(t).mutation(
      api.sharing.createCircle.createCircle,
      { name: "Saturday Puzzlers" },
    )) as string;
    await seatInCircle(t, circleId, mia);
    await seatInCircle(t, circleId, noah);
    const miaCircleShared = () =>
      t.run(async (ctx) =>
        (await collectCircleSharedCopies(ctx, mia)).map((c) => c._id),
      );

    const copyAggregateId = (await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;
    const copy = (await rowOf(t, copyAggregateId))._id;
    await t.run(async (ctx) => ctx.db.patch(copy, { availability: OPEN }));
    await asAlice(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId: copyAggregateId,
    });
    expect(await sharesOf(t, copyAggregateId)).toHaveLength(1);
    expect(await miaCircleShared()).toContain(copy);

    await settleSaleToNoah(t, copy, alice);
    expect((await rowOf(t, copyAggregateId)).ownerId).toBe(noah);
    await t.run(async (ctx) => ctx.db.patch(copy, { availability: OPEN }));

    // Sharing Noah's circle gives Mia no path by itself: only copies Noah shares into it are
    // reachable, and he never shared this one. Noah is private, not mutual, not in her household,
    // so no other rule lets her see it either.
    expect(await miaCircleShared()).not.toContain(copy);
    const after = await miaReach(t, copy, puzzleId);
    expect(after.instance).toBeNull();
    expect(after.inBrowse).toBe(false);
    expect(after.inDefinition).toBe(false);
    expect(await sharesOf(t, copyAggregateId)).toEqual([]);
  });
});
