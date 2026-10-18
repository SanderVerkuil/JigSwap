import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { collectCircleSharedCopies } from "./library/circleSharedCopies";
import schema from "./schema";

// #191 (after #155): the circle-aware policy's scopeOf must agree with canViewCopy's isCopyPrivate
// early return. An owner-chosen PRIVATE copy shared into a circle grants circle-mates nothing; an
// open copy and a legacy non-open row (its stored "private" was the old default, effective
// "visible") keep their mapping.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const NOW = 1_000_000;

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

const NONE = { forTrade: false, forSale: false, forLend: false };

describe("circle-shared copies honour the owner's private toggle", () => {
  test("a private copy shared into a circle is not collected for a circle-mate; open and legacy copies are", async () => {
    const t = convexTest(schema, modules);
    const viewer = await t.run(async (ctx) => {
      const owner = await mkUser(ctx, "clerk_owner");
      const viewer = await mkUser(ctx, "clerk_viewer");
      const puzzle = await ctx.db.insert("puzzles", {
        aggregateId: "def-1",
        title: "Lighthouse",
        pieceCount: 1000,
        status: "approved",
        submittedBy: owner,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const copy = (
        aggregateId: string,
        extra: Partial<Doc<"ownedPuzzles">>,
      ): Promise<Id<"ownedPuzzles">> =>
        ctx.db.insert("ownedPuzzles", {
          aggregateId,
          puzzleId: puzzle,
          ownerId: owner,
          condition: "good",
          availability: NONE,
          createdAt: NOW,
          updatedAt: NOW,
          ...extra,
        });
      await copy("copy-private", {
        visibility: "private",
        visibilityAuthoritative: true,
      });
      await copy("copy-open", {
        availability: { ...NONE, forTrade: true },
      });
      await copy("copy-legacy", { visibility: "private" }); // not authoritative

      await ctx.db.insert("circles", {
        aggregateId: "C",
        ownerId: owner,
        name: "C",
        memberships: [owner, viewer].map((memberId, i) => ({
          id: `C-m${i}`,
          memberId,
          permission: "ViewOnly" as const,
          joinedAt: NOW,
        })),
        createdAt: NOW,
      });
      for (const memberId of [owner, viewer]) {
        await ctx.db.insert("circleMembers", {
          circleAggregateId: "C",
          memberId,
        });
      }
      for (const copyId of ["copy-private", "copy-open", "copy-legacy"]) {
        await ctx.db.insert("circleCopyShares", {
          circleId: "C",
          copyId,
          sharedAt: NOW,
        });
      }
      return viewer;
    });

    const collected = await t.run(async (ctx) =>
      (await collectCircleSharedCopies(ctx, viewer))
        .map((c) => c.aggregateId)
        .sort(),
    );
    expect(collected).toEqual(["copy-legacy", "copy-open"]);
  });
});
