import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { RESHARE_SCAN_CAP } from "./sharing/backfillStaleCircleShares";

// sharing/backfillStaleCircleShares: before #184 an ownership transfer left the copy's
// `circleCopyShares` rows behind, so the previous owner's circle kept reaching the new owner's copy
// (worst when the new owner sits in that same circle). The backfill deletes a share only when the
// copy's custody chain PROVES its current owner is not the member who shared it, plus shares whose
// copy is gone. Rows are seeded directly (shares, custody entries, share events) so the legacy state
// exists regardless of whether #184's in-transaction cleanup is deployed.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The backfill reschedules itself via runAfter(0); yield a macrotask then drain, a few times.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const CIRCLE = "circle-saturday";
const OTHER_CIRCLE = "circle-sunday";

type Transfer = { from: "alice" | "noah"; to: "alice" | "noah"; at: number };
type Case = {
  owner: "alice" | "noah";
  sharedAt: number;
  transfers?: Transfer[];
  // CopySharedToCircle events in the durable log for this copy (circle + time).
  shareEvents?: { circleId: string; at: number }[];
  deleted: boolean;
};

// Alice shared each copy into CIRCLE at `sharedAt`; Noah (also in CIRCLE) may have bought it since.
const CASES: Record<string, Case> = {
  // Transferred to Noah after Alice shared it: Noah never chose to share it -> stale.
  stale: {
    owner: "noah",
    sharedAt: 1000,
    transfers: [{ from: "alice", to: "noah", at: 2000 }],
    shareEvents: [{ circleId: CIRCLE, at: 1000 }],
    deleted: true,
  },
  // Never changed hands: Alice still owns what she shared -> valid.
  valid: { owner: "alice", sharedAt: 1000, deleted: false },
  // Noah bought it first and shared it himself afterwards -> valid.
  sharedByNewOwner: {
    owner: "noah",
    sharedAt: 3000,
    transfers: [{ from: "alice", to: "noah", at: 2000 }],
    deleted: false,
  },
  // Went to Noah and back to Alice: the sharer owns it again -> kept.
  returnedToSharer: {
    owner: "alice",
    sharedAt: 1000,
    transfers: [
      { from: "alice", to: "noah", at: 2000 },
      { from: "noah", to: "alice", at: 3000 },
    ],
    deleted: false,
  },
  // Noah re-shared it into the same circle after buying it (the projection kept the old row and its
  // old sharedAt) -> he did choose to share it, kept.
  resharedByNewOwner: {
    owner: "noah",
    sharedAt: 1000,
    transfers: [{ from: "alice", to: "noah", at: 2000 }],
    shareEvents: [
      { circleId: CIRCLE, at: 1000 },
      { circleId: CIRCLE, at: 2500 },
    ],
    deleted: false,
  },
  // Noah shared it into a DIFFERENT circle: says nothing about this one -> still stale.
  staleDespiteOtherCircleShare: {
    owner: "noah",
    sharedAt: 1000,
    transfers: [{ from: "alice", to: "noah", at: 2000 }],
    shareEvents: [{ circleId: OTHER_CIRCLE, at: 2500 }],
    deleted: true,
  },
};
const STALE = Object.values(CASES).filter((c) => c.deleted).length;
const KEPT = Object.values(CASES).length - STALE;
const DANGLING_COPY = "copy-that-was-deleted";

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
    const members = {
      alice: await mkUser("clerk_alice"),
      noah: await mkUser("clerk_noah"),
    };
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      searchableText: "Mountain Vista",
      status: "approved",
      submittedBy: members.alice,
      createdAt: now,
      updatedAt: now,
    });

    const copyOf: Record<string, string> = {};
    for (const [name, c] of Object.entries(CASES)) {
      const aggregateId = `copy-${name}`;
      copyOf[name] = aggregateId;
      const copy = await ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId: members[c.owner],
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: true },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("circleCopyShares", {
        circleId: CIRCLE,
        copyId: aggregateId,
        sharedAt: c.sharedAt,
      });
      for (const tr of c.transfers ?? []) {
        await ctx.db.insert("copyCustodyEntries", {
          copyId: copy as string,
          exchangeId: `exchange-${name}-${tr.at}`,
          previousOwner: members[tr.from] as string,
          newOwner: members[tr.to] as string,
          occurredAt: tr.at,
        });
      }
      for (const e of c.shareEvents ?? []) {
        await ctx.db.insert("domainEvents", {
          name: "CopySharedToCircle",
          payload: { circleId: e.circleId, copyId: aggregateId },
          occurredAt: e.at,
          context: "sharing",
          processedAt: e.at,
        });
      }
    }
    // A share whose copy was deleted afterwards (deleteCopy never withdrew shares).
    await ctx.db.insert("circleCopyShares", {
      circleId: CIRCLE,
      copyId: DANGLING_COPY,
      sharedAt: 1000,
    });
    return { copyOf };
  });

const remainingCopyIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query("circleCopyShares").collect())
      .map((s) => s.copyId)
      .sort(),
  );

const run = async (
  t: T,
  args: { dryRun?: boolean; batchSize?: number } = {},
) => {
  const first = await t.mutation(
    internal.sharing.backfillStaleCircleShares.backfillStaleCircleShares,
    args,
  );
  await flush(t);
  return first;
};

describe("backfillStaleCircleShares", () => {
  test("dry run counts without deleting; the real run deletes exactly the stale and dangling shares; a re-run deletes 0", async () => {
    const t = convexTest(schema, modules);
    const { copyOf } = await seed(t);
    const all = [...Object.values(copyOf), DANGLING_COPY].sort();
    const kept = Object.entries(CASES)
      .filter(([, c]) => !c.deleted)
      .map(([name]) => copyOf[name])
      .sort();

    expect(await run(t, { dryRun: true })).toEqual({
      scanned: STALE + KEPT + 1,
      stale: STALE,
      dangling: 1,
      kept: KEPT,
      undetermined: 0,
    });
    expect(await remainingCopyIds(t)).toEqual(all);

    expect(await run(t)).toEqual({
      scanned: STALE + KEPT + 1,
      stale: STALE,
      dangling: 1,
      kept: KEPT,
      undetermined: 0,
    });
    expect(await remainingCopyIds(t)).toEqual(kept);

    expect(await run(t)).toEqual({
      scanned: KEPT,
      stale: 0,
      dangling: 0,
      kept: KEPT,
      undetermined: 0,
    });
    expect(await remainingCopyIds(t)).toEqual(kept);
  });

  test("pages across batches until the table is exhausted", async () => {
    const t = convexTest(schema, modules);
    const { copyOf } = await seed(t);
    const kept = Object.entries(CASES)
      .filter(([, c]) => !c.deleted)
      .map(([name]) => copyOf[name])
      .sort();

    // The command returns only the FIRST batch; the rest run as scheduled functions.
    const first = await run(t, { batchSize: 2 });
    expect(first.scanned).toBe(2);
    expect(await remainingCopyIds(t)).toEqual(kept);
  });

  test("keeps a transferred share it cannot clear within the event scan cap (undetermined, not deleted)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const mkUser = (clerkId: string) =>
        ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.com`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      const alice = await mkUser("clerk_alice");
      const noah = await mkUser("clerk_noah");
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Mountain Vista",
        pieceCount: 1000,
        searchableText: "Mountain Vista",
        status: "approved",
        submittedBy: alice,
        createdAt: now,
        updatedAt: now,
      });
      const copy = await ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy-busy",
        puzzleId,
        ownerId: noah,
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: true },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("circleCopyShares", {
        circleId: CIRCLE,
        copyId: "copy-busy",
        sharedAt: 1000,
      });
      await ctx.db.insert("copyCustodyEntries", {
        copyId: copy as string,
        exchangeId: "exchange-busy",
        previousOwner: alice as string,
        newOwner: noah as string,
        occurredAt: 2000,
      });
      // Unrelated share events after the transfer fill the bounded scan window.
      for (let i = 0; i < RESHARE_SCAN_CAP; i++) {
        await ctx.db.insert("domainEvents", {
          name: "CopySharedToCircle",
          payload: { circleId: OTHER_CIRCLE, copyId: `other-${i}` },
          occurredAt: 2001 + i,
          context: "sharing",
        });
      }
    });

    expect(await run(t)).toEqual({
      scanned: 1,
      stale: 0,
      dangling: 0,
      kept: 0,
      undetermined: 1,
    });
    expect(await remainingCopyIds(t)).toEqual(["copy-busy"]);
  });
});
