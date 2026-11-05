import { LIVE_EXCHANGES_PER_READ } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// exchange/listMyLiveExchanges joins each row it returns: both parties, both copies, their
// definitions and covers. Convex allows 4,096 index ranges per function, so a member with hundreds of
// open proposals (reachable with a few dozen accounts) must get a bounded list, not a rejected query,
// on the dashboard and the Exchanges page. Runs with real transaction limits.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const BASE = 1_700_000_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };

type T = TestConvex<typeof schema>;

// The worst case per row: a distinct requester, a distinct copy on either side, a distinct definition
// behind each, and a cover photo on both copies. `count` rows, updated newest last.
const seedProposals = async (t: T, count: number) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { victim, image } = await t.run(async (ctx) => {
    const image = await ctx.storage.store(
      new Blob(["x"], { type: "image/webp" }),
    );
    const victim = await ctx.db.insert("users", {
      clerkId: "clerk_victim",
      email: "victim@example.com",
      name: "victim",
      isActive: true,
      createdAt: BASE,
      updatedAt: BASE,
    });
    return { victim, image };
  });
  const ids: string[] = [];
  const batch = 50;
  for (let start = 0; start < count; start += batch) {
    const made = await t.run(async (ctx) => {
      const out: string[] = [];
      for (let i = start; i < Math.min(count, start + batch); i++) {
        const initiatorId = await ctx.db.insert("users", {
          clerkId: `clerk_m${i}`,
          email: `m${i}@example.com`,
          name: `m${i}`,
          isActive: true,
          createdAt: BASE,
          updatedAt: BASE,
        });
        const copyOf = async (ownerId: Id<"users">, slug: string) => {
          const puzzleId = await ctx.db.insert("puzzles", {
            title: `${slug}-${i}`,
            pieceCount: 1000,
            status: "approved",
            image,
            submittedBy: victim,
            createdAt: BASE,
            updatedAt: BASE,
          });
          const copyId = await ctx.db.insert("ownedPuzzles", {
            aggregateId: `${slug}-copy-${i}`,
            puzzleId,
            ownerId,
            condition: "good",
            availability: OPEN,
            isOpen: true,
            listedAt: BASE,
            createdAt: BASE,
            updatedAt: BASE,
          });
          const cover = await ctx.db.insert("ownedPuzzleImages", {
            ownedPuzzleId: copyId,
            uploaderId: ownerId,
            fileId: image,
            createdAt: BASE,
            updatedAt: BASE,
          });
          await ctx.db.patch(copyId, { coverImageId: cover });
          return copyId;
        };
        const aggregateId = `x${i}`;
        await ctx.db.insert("exchanges", {
          aggregateId,
          initiatorId,
          recipientId: victim,
          type: "trade",
          requestedPuzzleId: await copyOf(victim, "wanted"),
          offeredPuzzleId: await copyOf(initiatorId, "offered"),
          status: "proposed",
          createdAt: BASE + i,
          updatedAt: BASE + i,
        });
        out.push(aggregateId);
      }
      return out;
    });
    ids.push(...made);
  }
  return ids;
};

const live = (t: T, page?: number) =>
  t
    .withIdentity({ subject: "clerk_victim" })
    .query(
      api.exchange.listMyLiveExchanges.listMyLiveExchanges,
      page === undefined ? {} : { page },
    );

describe("exchange.myLive under Convex's real limits", () => {
  test("500 live exchanges: the newest window comes back instead of a thrown read", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const ids = await seedProposals(t, 500);
    const rows = await live(t);
    expect(rows).toHaveLength(LIVE_EXCHANGES_PER_READ);
    expect(rows.map((row) => row.aggregateId)).toEqual(
      ids.slice(-LIVE_EXCHANGES_PER_READ).reverse(),
    );
  }, 300_000);

  test("every later window holds, and together they reach every row with none twice", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const count = LIVE_EXCHANGES_PER_READ * 2 + 5;
    const ids = await seedProposals(t, count);
    const seen = [
      ...(await live(t)),
      ...(await live(t, 1)),
      ...(await live(t, 2)),
    ].map((row) => row.aggregateId);
    expect(seen).toEqual([...ids].reverse());
    expect(await live(t, 3)).toEqual([]);
  }, 300_000);

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "a page of %s can't break the read",
    async (page) => {
      const t = convexTest(schema, modules);
      await seedProposals(t, 2);
      const rows = await live(t, page);
      expect(rows.length).toBeLessThanOrEqual(2);
    },
  );
});
