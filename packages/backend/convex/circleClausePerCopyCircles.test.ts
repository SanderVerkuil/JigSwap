import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { collectCircleSharedCopies } from "./library/circleSharedCopies";
import schema from "./schema";

// #181 follow-up: a copy shared into circles A and C, whose owner has LEFT A but is still in C with
// the viewer, stays visible via the circle path — and the policy is handed exactly [C] for it.

// Record what the circle-aware policy is asked about: per canView, the copy and the per-copy circles
// the caller resolved. Calls straight through to the real policy, so visibility is unaffected.
const seen = vi.hoisted(() => [] as { copyId: string; circles: string[] }[]);
vi.mock(
  "./library/adapters/circleAwareVisibilityPolicy",
  async (importActual) => {
    const actual =
      await importActual<
        typeof import("./library/adapters/circleAwareVisibilityPolicy")
      >();
    return {
      makeCircleAwareVisibilityPolicy: (
        sharedCircles: Parameters<
          typeof actual.makeCircleAwareVisibilityPolicy
        >[0],
      ) => {
        const policy = actual.makeCircleAwareVisibilityPolicy(sharedCircles);
        return {
          canView: (viewer, copy) => {
            seen.push({
              copyId: copy.id as string,
              circles: sharedCircles(copy).map((c) => c as string),
            });
            return policy.canView(viewer, copy);
          },
          canTransact: policy.canTransact,
        } satisfies ReturnType<typeof actual.makeCircleAwareVisibilityPolicy>;
      },
    };
  },
);

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const NOW = 1_000_000;

const mkUser = (ctx: MutationCtx, clerkId: string, name: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
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

beforeEach(() => {
  seen.length = 0;
});

describe("per-copy circles handed to the circle-aware policy (#181)", () => {
  test("shared into A and C, owner left A: visible via C, and the policy sees exactly [C]", async () => {
    const t = convexTest(schema, modules);
    const { viewer, copy } = await t.run(async (ctx) => {
      const owner = await mkUser(ctx, "clerk_owner", "Hidden Owner");
      const viewer = await mkUser(ctx, "clerk_viewer", "Viewer");
      // Private owner, no follows: the circle path is the only way in.
      await ctx.db.insert("profiles", {
        memberId: owner,
        displayName: "Hidden Owner",
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
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: NOW,
        updatedAt: NOW,
      });
      // The owner has left A (no junction row there); owner and viewer are both seated in C.
      await mkCircle(ctx, "A", viewer, [viewer]);
      await mkCircle(ctx, "C", owner, [owner, viewer]);
      for (const circleId of ["A", "C"]) {
        await ctx.db.insert("circleCopyShares", {
          circleId,
          copyId: "copy-1",
          sharedAt: NOW,
        });
      }
      return { viewer, copy };
    });

    const collected = await t.run(async (ctx) =>
      (await collectCircleSharedCopies(ctx, viewer)).map((c) => c.aggregateId),
    );
    expect(collected).toEqual(["copy-1"]);
    expect(seen).toEqual([{ copyId: "copy-1", circles: ["C"] }]);

    seen.length = 0;
    const view = await t
      .withIdentity({ subject: "clerk_viewer" })
      .query(api.library.getCopyInstanceView.getCopyInstanceView, {
        copyId: copy,
      });
    expect(view).not.toBeNull();
    expect(seen).toEqual([{ copyId: "copy-1", circles: ["C"] }]);
  });
});
