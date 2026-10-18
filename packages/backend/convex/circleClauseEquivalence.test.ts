import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { canViewCopy } from "./library/canViewCopy";
import {
  collectCircleSharedCopies,
  isCircleSharedWithViewer,
} from "./library/circleSharedCopies";
import schema from "./schema";

// #190: the bounded single-copy circle check (by_copy lookup) must decide exactly what the batched
// collector decides, for every #181 scoping case.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const NOW = 1_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

type U = { owner: Id<"users">; viewer: Id<"users"> };

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

// `listed` go in the embedded memberships, `joined` get a circleMembers junction row; `row: false`
// leaves only the junction rows (an orphaned projection with no circles row).
const mkCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  ownerId: Id<"users">,
  listed: Id<"users">[],
  joined: Id<"users">[],
  row = true,
) => {
  if (row) {
    await ctx.db.insert("circles", {
      aggregateId,
      ownerId,
      name: aggregateId,
      memberships: listed.map((memberId, i) => ({
        id: `${aggregateId}-m${i}`,
        memberId,
        permission: "ViewOnly" as const,
        joinedAt: NOW,
      })),
      createdAt: NOW,
    });
  }
  for (const memberId of joined) {
    await ctx.db.insert("circleMembers", {
      circleAggregateId: aggregateId,
      memberId,
    });
  }
};

type Case = {
  name: string;
  sharedInto: string[];
  circles: (ctx: MutationCtx, u: U) => Promise<void>;
  expected: boolean;
};

const cases: Case[] = [
  {
    name: "viewer and owner both seated in A",
    sharedInto: ["A"],
    circles: (ctx, u) =>
      mkCircle(ctx, "A", u.owner, [u.owner, u.viewer], [u.owner, u.viewer]),
    expected: true,
  },
  {
    name: "stale share: owner left A",
    sharedInto: ["A"],
    circles: (ctx, u) => mkCircle(ctx, "A", u.viewer, [u.viewer], [u.viewer]),
    expected: false,
  },
  {
    name: "viewer left A",
    sharedInto: ["A"],
    circles: (ctx, u) => mkCircle(ctx, "A", u.owner, [u.owner], [u.owner]),
    expected: false,
  },
  {
    name: "viewer listed in A without a junction row",
    sharedInto: ["A"],
    circles: (ctx, u) =>
      mkCircle(ctx, "A", u.owner, [u.owner, u.viewer], [u.owner]),
    expected: false,
  },
  {
    name: "owner listed in A without a junction row",
    sharedInto: ["A"],
    circles: (ctx, u) =>
      mkCircle(ctx, "A", u.viewer, [u.owner, u.viewer], [u.viewer]),
    expected: false,
  },
  {
    name: "shared into A, viewer and owner only share B",
    sharedInto: ["A"],
    circles: async (ctx, u) => {
      await mkCircle(ctx, "A", u.viewer, [u.viewer], [u.viewer]);
      await mkCircle(
        ctx,
        "B",
        u.owner,
        [u.owner, u.viewer],
        [u.owner, u.viewer],
      );
    },
    expected: false,
  },
  {
    name: "shared into A and C, owner left A, both seated in C",
    sharedInto: ["A", "C"],
    circles: async (ctx, u) => {
      await mkCircle(ctx, "A", u.viewer, [u.viewer], [u.viewer]);
      await mkCircle(
        ctx,
        "C",
        u.owner,
        [u.owner, u.viewer],
        [u.owner, u.viewer],
      );
    },
    expected: true,
  },
  {
    name: "junction rows for both but no circles row",
    sharedInto: ["A"],
    circles: (ctx, u) =>
      mkCircle(ctx, "A", u.owner, [], [u.owner, u.viewer], false),
    expected: false,
  },
  {
    name: "both seated in A but the copy is not shared anywhere",
    sharedInto: [],
    circles: (ctx, u) =>
      mkCircle(ctx, "A", u.owner, [u.owner, u.viewer], [u.owner, u.viewer]),
    expected: false,
  },
];

describe("single-copy circle check == batched collector (#190)", () => {
  for (const availability of [OPEN, CLOSED]) {
    const label = availability.forTrade ? "open" : "closed";
    for (const c of cases) {
      test(`${label}: ${c.name}`, async () => {
        const t = convexTest(schema, modules);
        const result = await t.run(async (ctx) => {
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
          const copy = await ctx.db.insert("ownedPuzzles", {
            aggregateId: "copy-1",
            puzzleId: puzzle,
            ownerId: owner,
            condition: "good",
            availability,
            createdAt: NOW,
            updatedAt: NOW,
          });
          for (const circleId of c.sharedInto) {
            await ctx.db.insert("circleCopyShares", {
              circleId,
              copyId: "copy-1",
              sharedAt: NOW,
            });
          }
          await c.circles(ctx, { owner, viewer });
          const row = (await ctx.db.get(copy))!;
          return {
            single: await isCircleSharedWithViewer(ctx, viewer, row),
            batched: (await collectCircleSharedCopies(ctx, viewer)).some(
              (r) => r._id === copy,
            ),
            canView: await canViewCopy(ctx, viewer, row),
          };
        });
        expect(result.single).toBe(result.batched);
        expect(result.single).toBe(c.expected);
        // Private owner, no follows, no household: the circle clause (open copies only) is the
        // only way canViewCopy can say yes.
        expect(result.canView).toBe(c.expected && availability.forTrade);
      });
    }
  }
});
