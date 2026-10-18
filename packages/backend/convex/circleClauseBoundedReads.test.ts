import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  buildCopyViewContext,
  canViewCopy,
  canViewCopyWithContext,
} from "./library/canViewCopy";
import {
  CIRCLE_SHARES_READ_PER_CIRCLE,
  collectCircleSharedCopies,
} from "./library/circleSharedCopies";
import schema from "./schema";

// #190: a single-copy circle check must read O(shares of THAT copy), never every share in every
// circle the viewer is in; the batched collector (browse) reads at most a documented cap per circle.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const NOW = 1_000_000;

// Wrap ctx.db so every row a `circleCopyShares` query yields (collect/take/first/unique) is counted.
const countingShareReads = (ctx: QueryCtx) => {
  const counter = { rows: 0 };
  const wrap = (q: object): object =>
    new Proxy(q, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
          if (result instanceof Promise) {
            return result.then((rows: unknown) => {
              counter.rows += Array.isArray(rows) ? rows.length : rows ? 1 : 0;
              return rows;
            });
          }
          return result !== null && typeof result === "object"
            ? wrap(result)
            : result;
        };
      },
    });
  const db = new Proxy(ctx.db, {
    get(target, prop) {
      if (prop === "query") {
        return (table: string) => {
          const q = target.query(table as "circleCopyShares");
          return table === "circleCopyShares" ? wrap(q) : q;
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db } as QueryCtx, counter };
};

const mkUser = (ctx: MutationCtx, clerkId: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: clerkId,
    username: clerkId,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

const mkCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  ownerId: Id<"users">,
  joined: Id<"users">[],
) => {
  await ctx.db.insert("circles", {
    aggregateId,
    ownerId,
    name: aggregateId,
    memberships: joined.map((memberId, i) => ({
      id: `${aggregateId}-m${i}`,
      memberId,
      permission: "ViewOnly" as const,
      joinedAt: NOW,
    })),
    createdAt: NOW,
  });
  for (const memberId of joined) {
    await ctx.db.insert("circleMembers", {
      circleAggregateId: aggregateId,
      memberId,
    });
  }
};

const mkCopy = (
  ctx: MutationCtx,
  aggregateId: string,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
) =>
  ctx.db.insert("ownedPuzzles", {
    aggregateId,
    puzzleId,
    ownerId,
    condition: "good",
    availability: { forTrade: true, forSale: false, forLend: false },
    createdAt: NOW,
    updatedAt: NOW,
  });

// A private owner and a viewer sharing CIRCLES circles; each circle holds `othersPerCircle` shares
// of OTHER copies, and the target copy is shared into circles 0 and 1 only.
const seed =
  (circles: number, othersPerCircle: number) => async (ctx: MutationCtx) => {
    const owner = await mkUser(ctx, "clerk_owner");
    const viewer = await mkUser(ctx, "clerk_viewer");
    await ctx.db.insert("profiles", {
      memberId: owner,
      displayName: "Owner",
      visibility: "private",
      updatedAt: NOW,
    });
    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Lighthouse",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const target = await mkCopy(ctx, "target", puzzle, owner);
    for (let c = 0; c < circles; c++) {
      await mkCircle(ctx, `C${c}`, owner, [owner, viewer]);
      for (let i = 0; i < othersPerCircle; i++) {
        const id = `other-${c}-${i}`;
        await mkCopy(ctx, id, puzzle, owner);
        await ctx.db.insert("circleCopyShares", {
          circleId: `C${c}`,
          copyId: id,
          sharedAt: NOW,
        });
      }
    }
    for (const circleId of ["C0", "C1"]) {
      await ctx.db.insert("circleCopyShares", {
        circleId,
        copyId: "target",
        sharedAt: NOW,
      });
    }
    return { viewer, target };
  };

describe("circle clause read bounds (#190)", () => {
  test("canViewCopy reads only the target copy's shares", async () => {
    const t = convexTest(schema, modules);
    const { viewer, target } = await t.run(seed(4, 15));
    await t.run(async (raw) => {
      const { ctx, counter } = countingShareReads(raw);
      const row = (await raw.db.get(target))!;
      expect(await canViewCopy(ctx, viewer, row)).toBe(true);
      expect(counter.rows).toBeLessThanOrEqual(2);
    });
  });

  test("canViewCopyWithContext (prebuilt context) reads only the checked copy's shares", async () => {
    const t = convexTest(schema, modules);
    const { viewer, target } = await t.run(seed(4, 15));
    await t.run(async (raw) => {
      const { ctx, counter } = countingShareReads(raw);
      const context = await buildCopyViewContext(ctx, viewer);
      const row = (await raw.db.get(target))!;
      expect(await canViewCopyWithContext(ctx, row, context)).toBe(true);
      expect(counter.rows).toBeLessThanOrEqual(2);
    });
  });

  test("the batched collector reads at most the documented cap per circle", async () => {
    const t = convexTest(schema, modules);
    const { viewer } = await t.run(seed(1, CIRCLE_SHARES_READ_PER_CIRCLE + 5));
    await t.run(async (raw) => {
      const { ctx, counter } = countingShareReads(raw);
      const collected = await collectCircleSharedCopies(ctx, viewer);
      expect(counter.rows).toBeLessThanOrEqual(CIRCLE_SHARES_READ_PER_CIRCLE);
      expect(collected).toHaveLength(CIRCLE_SHARES_READ_PER_CIRCLE);
    });
  });
});
