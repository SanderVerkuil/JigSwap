import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  isCircleSharedWithViewer,
  MAX_CIRCLE_CLAUSE_RANGES,
} from "./library/circleSharedCopies";
import schema from "./schema";

// How many circles a copy is shared into is up to its OWNER (solo circles are free to make), and every
// list that decides a private owner's rows one by one asks that of each row. So what a row costs must
// not follow the owner's share count, or one account breaks a page for whoever it touches. Nor may it
// follow the VIEWER's circle count row after row: that lets a stranger's rows break the page of anyone
// in a good few circles. The viewer's circles are read once per function call. All of these threw "Too
// many index ranges" under one or the other.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const BASE = 1_700_000_000_000;
const OPEN = { forTrade: true, forSale: false, forLend: false };

const limited = () => convexTest({ schema, modules, transactionLimits: true });

const mkUser = (ctx: MutationCtx, name: string) =>
  ctx.db.insert("users", {
    clerkId: `clerk_${name}`,
    email: `${name}@example.com`,
    name,
    isActive: true,
    createdAt: BASE,
    updatedAt: BASE,
  });

const mkPrivateUser = async (ctx: MutationCtx, name: string) => {
  const memberId = await mkUser(ctx, name);
  await ctx.db.insert("profiles", {
    memberId,
    visibility: "private",
    updatedAt: BASE,
  });
  return memberId;
};

const mkCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  ownerId: Id<"users">,
  members: Id<"users">[],
) => {
  await ctx.db.insert("circles", {
    aggregateId,
    ownerId,
    name: aggregateId,
    memberships: members.map((memberId, i) => ({
      id: `${aggregateId}-${i}`,
      memberId,
      permission: "Exchange" as const,
      joinedAt: BASE,
    })),
    createdAt: BASE,
  });
  for (const memberId of members) {
    await ctx.db.insert("circleMembers", {
      circleAggregateId: aggregateId,
      memberId,
    });
  }
};

const shareInto = async (
  ctx: MutationCtx,
  copyId: string,
  circleIds: string[],
) => {
  for (const circleId of circleIds) {
    await ctx.db.insert("circleCopyShares", {
      circleId,
      copyId,
      sharedAt: BASE,
    });
  }
};

const definition = (ctx: MutationCtx, title: string, by: Id<"users">) =>
  ctx.db.insert("puzzles", {
    title,
    pieceCount: 1000,
    status: "approved",
    submittedBy: by,
    createdAt: BASE,
    updatedAt: BASE,
  });

// An open copy of a private owner.
const openCopy = (
  ctx: MutationCtx,
  aggregateId: string,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  at = BASE,
) =>
  ctx.db.insert("ownedPuzzles", {
    aggregateId,
    puzzleId,
    ownerId,
    condition: "good",
    availability: OPEN,
    isOpen: true,
    listedAt: at,
    ownerPrivate: true,
    createdAt: at,
    updatedAt: at,
  });

const soloCircles = async (
  t: T,
  prefix: string,
  owner: Id<"users">,
  count: number,
) => {
  const ids = Array.from({ length: count }, (_, c) => `${prefix}-${c}`);
  await t.run(async (ctx) => {
    for (const id of ids) await mkCircle(ctx, id, owner, [owner]);
  });
  return ids;
};

describe("the member definition page", () => {
  test.each([
    [41, 100],
    [60, 100],
    [200, 20],
    [200, 5],
    [200, 6],
  ])(
    "holds for a stranger with %i copies, each in %i of one private owner's circles",
    async (copies, shares) => {
      const t = limited();
      const { puzzleId, attacker } = await t.run(async (ctx) => {
        await mkUser(ctx, "viewer");
        const attacker = await mkPrivateUser(ctx, "attacker");
        return {
          attacker,
          puzzleId: await definition(ctx, "popular", attacker),
        };
      });
      const circles = await soloCircles(t, "solo", attacker, shares);
      for (let start = 0; start < copies; start += 10) {
        await t.run(async (ctx) => {
          for (let i = start; i < Math.min(copies, start + 10); i++) {
            await openCopy(ctx, `copy-${i}`, puzzleId, attacker, BASE + i);
            await shareInto(ctx, `copy-${i}`, circles);
          }
        });
      }

      const view = await t
        .withIdentity({ subject: "clerk_viewer" })
        .query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
          puzzleId,
        });

      expect(view?.definition.title).toBe("popular");
    },
    120_000,
  );
});

// Each offered copy with a cover still being checked, which costs a copy gate to find out.
const seedProposals = async (t: T, proposals: number, shares: number) => {
  const { victim, attacker } = await t.run(async (ctx) => ({
    victim: await mkUser(ctx, "victim"),
    attacker: await mkPrivateUser(ctx, "attacker"),
  }));
  const circles = await soloCircles(t, "solo", attacker, shares);
  for (let i = 0; i < proposals; i++) {
    await t.run(async (ctx) => {
      const puzzleId = await definition(ctx, `d${i}`, victim);
      const wanted = await ctx.db.insert("ownedPuzzles", {
        aggregateId: `wanted-${i}`,
        puzzleId,
        ownerId: victim,
        condition: "good",
        availability: OPEN,
        isOpen: true,
        listedAt: BASE,
        createdAt: BASE,
        updatedAt: BASE,
      });
      const offered = await openCopy(ctx, `offered-${i}`, puzzleId, attacker);
      await shareInto(ctx, `offered-${i}`, circles);
      const cover = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: offered,
        uploaderId: attacker,
        fileId: await ctx.storage.store(new Blob(["x"])),
        moderationStatus: "pending",
        createdAt: BASE,
        updatedAt: BASE,
      });
      await ctx.db.patch(offered, { coverImageId: cover });
      await ctx.db.insert("exchanges", {
        aggregateId: `x${i}`,
        initiatorId: attacker,
        recipientId: victim,
        type: "trade",
        requestedPuzzleId: wanted,
        offeredPuzzleId: offered,
        status: "proposed",
        createdAt: BASE + i,
        updatedAt: BASE + i,
      });
    });
  }
};

describe("exchange.myLive", () => {
  test.each([
    [40, 100],
    [100, 30],
    [100, 5],
    [100, 6],
  ])(
    "holds for the owner %i proposals target, their offered copies in %i circles",
    async (proposals, shares) => {
      const t = limited();
      await seedProposals(t, proposals, shares);

      const rows = await t
        .withIdentity({ subject: "clerk_victim" })
        .query(api.exchange.listMyLiveExchanges.listMyLiveExchanges, {});

      expect(rows).toHaveLength(proposals);
    },
    120_000,
  );
});

describe("Browse's first page", () => {
  test.each([
    [24, 100],
    [24, 4],
  ])(
    "holds with %i rows each of two private circle mates, every copy in %i more of their circles",
    async (rowsEach, extraShares) => {
      const t = limited();
      const { a, b } = await t.run(async (ctx) => {
        const viewer = await mkUser(ctx, "viewer");
        const a = await mkPrivateUser(ctx, "a");
        const b = await mkPrivateUser(ctx, "b");
        await mkCircle(ctx, "shared", a, [a, b, viewer]);
        return { a, b };
      });
      const expected: string[] = [];
      for (const [owner, prefix] of [
        [a, "a"],
        [b, "b"],
      ] as const) {
        const circles = await soloCircles(t, `s${prefix}`, owner, extraShares);
        for (let r = 0; r < rowsEach; r++) {
          await t.run(async (ctx) => {
            const copyId = `${prefix}-${r}`;
            const puzzleId = await definition(ctx, copyId, owner);
            expected.push(
              await openCopy(ctx, copyId, puzzleId, owner, BASE + r),
            );
            await shareInto(ctx, copyId, ["shared", ...circles]);
          });
        }
      }

      const { ownedPuzzles } = await t
        .withIdentity({ subject: "clerk_viewer" })
        .query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {
          limit: 48,
        });

      // Still found through the one circle they have in common, whichever way it is reached.
      expect(ownedPuzzles.map((row) => row._id).sort()).toEqual(
        [...expected].sort(),
      );
    },
    120_000,
  );
});

describe("a viewer's own circles decide, however the copy reaches them", () => {
  test("among many shares, the viewer's circle still counts, and an unrelated one doesn't", async () => {
    const t = limited();
    const { owner, puzzleId } = await t.run(async (ctx) => {
      const owner = await mkPrivateUser(ctx, "owner");
      await mkUser(ctx, "mate");
      await mkUser(ctx, "stranger");
      return { owner, puzzleId: await definition(ctx, "shelf", owner) };
    });
    const circles = await soloCircles(t, "solo", owner, 8);
    const copy = await t.run(async (ctx) => {
      const copy = await openCopy(ctx, "the-copy", puzzleId, owner);
      await shareInto(ctx, "the-copy", circles);
      const mate = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_mate"))
        .unique();
      await mkCircle(ctx, "with-mate", owner, [owner, mate!._id]);
      await shareInto(ctx, "the-copy", ["with-mate"]);
      return copy;
    });
    const browseAs = (name: string) =>
      t
        .withIdentity({ subject: `clerk_${name}` })
        .query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, {});

    expect((await browseAs("mate")).ownedPuzzles.map((r) => r._id)).toEqual([
      copy,
    ]);
    expect((await browseAs("stranger")).ownedPuzzles).toEqual([]);
  });
});

// What the definition page's rows cost must not grow with the viewer's circles row after row either.
describe("a viewer in a good few circles", () => {
  const seedOwnerRows = async (
    t: T,
    puzzleId: Id<"puzzles">,
    name: string,
    copies: number,
    shares: number,
  ) => {
    const owner = await t.run((ctx) => mkPrivateUser(ctx, name));
    const circles = await soloCircles(t, `solo-${name}`, owner, shares);
    for (let start = 0; start < copies; start += 10) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(copies, start + 10); i++) {
          await openCopy(ctx, `${name}-${i}`, puzzleId, owner, BASE + i);
          await shareInto(ctx, `${name}-${i}`, circles);
        }
      });
    }
    return owner;
  };

  const viewDefinition = (t: T, puzzleId: Id<"puzzles">) =>
    t
      .withIdentity({ subject: "clerk_viewer" })
      .query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
        puzzleId,
      });

  const seedViewer = async (t: T, circles: number) => {
    const { viewer, puzzleId } = await t.run(async (ctx) => {
      const viewer = await mkUser(ctx, "viewer");
      return { viewer, puzzleId: await definition(ctx, "popular", viewer) };
    });
    await soloCircles(t, "mine", viewer, circles);
    return { viewer, puzzleId };
  };

  test.each([20, 50, 100, 500])(
    "the definition page holds in %i circles, against one stranger's 200 copies in 6 circles each",
    async (circles) => {
      const t = limited();
      const { puzzleId } = await seedViewer(t, circles);
      await seedOwnerRows(t, puzzleId, "attacker", 200, 6);

      const view = await viewDefinition(t, puzzleId);

      expect(view?.totalAvailable).toBe(0);
    },
    120_000,
  );

  test("the definition page holds in 50 circles, against ten strangers with 20 copies each", async () => {
    const t = limited();
    const { puzzleId } = await seedViewer(t, 50);
    for (let o = 0; o < 10; o++) {
      await seedOwnerRows(t, puzzleId, `attacker${o}`, 20, 6);
    }

    expect((await viewDefinition(t, puzzleId))?.totalAvailable).toBe(0);
  }, 120_000);

  test("the definition page holds in 50 circles, against 200 strangers with a copy each", async () => {
    const t = limited();
    const { puzzleId } = await seedViewer(t, 50);
    for (let o = 0; o < 200; o++) {
      await seedOwnerRows(t, puzzleId, `attacker${o}`, 1, 6);
    }

    expect((await viewDefinition(t, puzzleId))?.totalAvailable).toBe(0);
  }, 120_000);

  test.each([25, 50, 100])(
    "exchange.myLive holds in %i circles, against 100 proposals at 6 shares",
    async (circles) => {
      const t = limited();
      await seedProposals(t, 100, 6);
      const victim = await t.run(async (ctx) => {
        const row = await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_victim"))
          .unique();
        return row!._id;
      });
      await soloCircles(t, "mine", victim, circles);

      const rows = await t
        .withIdentity({ subject: "clerk_victim" })
        .query(api.exchange.listMyLiveExchanges.listMyLiveExchanges, {});

      expect(rows).toHaveLength(100);
    },
    120_000,
  );

  // Circle mates' copies, reached through the circle, must all still come back.
  test("the definition page finds all 200 copies of a circle mate who sits in three of the viewer's 50 circles", async () => {
    const t = limited();
    const { viewer, puzzleId } = await seedViewer(t, 47);
    const owner = await t.run((ctx) => mkPrivateUser(ctx, "mate"));
    await t.run(async (ctx) => {
      for (const id of ["with-mate-0", "with-mate-1", "with-mate-2"]) {
        await mkCircle(ctx, id, owner, [owner, viewer]);
      }
    });
    const others = await soloCircles(t, "mate-solo", owner, 6);
    for (let start = 0; start < 200; start += 10) {
      await t.run(async (ctx) => {
        for (let i = start; i < start + 10; i++) {
          await openCopy(ctx, `mate-${i}`, puzzleId, owner, BASE + i);
          await shareInto(ctx, `mate-${i}`, [...others, "with-mate-2"]);
        }
      });
    }

    expect((await viewDefinition(t, puzzleId))?.totalAvailable).toBe(200);
  }, 120_000);

  // A member can only get this many probes per row with the viewer's consent: every one of these is a
  // circle the viewer joined. It still mustn't reject the page: past the clause's budget a copy just
  // isn't offered, as past the view's other bounds.
  test("seated with one owner in 30 circles holding all 200 copies, the page holds and offers what the budget reaches", async () => {
    const t = limited();
    const { viewer, puzzleId } = await seedViewer(t, 0);
    const owner = await t.run((ctx) => mkPrivateUser(ctx, "mate"));
    const circles = Array.from({ length: 30 }, (_, c) => `with-mate-${c}`);
    await t.run(async (ctx) => {
      for (const id of circles) await mkCircle(ctx, id, owner, [owner, viewer]);
    });
    for (let start = 0; start < 200; start += 10) {
      await t.run(async (ctx) => {
        for (let i = start; i < start + 10; i++) {
          await openCopy(ctx, `mate-${i}`, puzzleId, owner, BASE + i);
          await shareInto(ctx, `mate-${i}`, circles);
        }
      });
    }

    const offered = (await viewDefinition(t, puzzleId))?.totalAvailable ?? 0;

    expect(offered).toBeGreaterThan(0);
    expect(offered).toBeLessThanOrEqual(
      Math.floor(MAX_CIRCLE_CLAUSE_RANGES / circles.length),
    );
  }, 120_000);
});

describe("how long what it read of the viewer's circles holds", () => {
  const seedShared = (t: T) =>
    t.run(async (ctx) => {
      const viewer = await mkUser(ctx, "viewer");
      const owner = await mkPrivateUser(ctx, "owner");
      const puzzleId = await definition(ctx, "shelf", owner);
      await mkCircle(ctx, "both", owner, [owner, viewer]);
      const copy = await openCopy(ctx, "the-copy", puzzleId, owner);
      await shareInto(ctx, "the-copy", ["both"]);
      return { viewer, owner, copy };
    });

  test("a mutation that changes a circle sees the change on its next check", async () => {
    const t = limited();
    const { viewer, owner, copy } = await seedShared(t);

    await t.run(async (ctx) => {
      const row = (await ctx.db.get(copy))!;
      expect(await isCircleSharedWithViewer(ctx, viewer, row)).toBe(true);

      const seat = await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q.eq("circleAggregateId", "both").eq("memberId", owner),
        )
        .unique();
      await ctx.db.delete(seat!._id);

      expect(await isCircleSharedWithViewer(ctx, viewer, row)).toBe(false);
    });
  });

  test("the next read sees a change made since the last", async () => {
    const t = limited();
    const { viewer, owner, copy } = await seedShared(t);
    const read = () =>
      t.query(async (ctx) =>
        isCircleSharedWithViewer(ctx, viewer, (await ctx.db.get(copy))!),
      );

    expect(await read()).toBe(true);
    await t.run(async (ctx) => {
      const seat = await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q.eq("circleAggregateId", "both").eq("memberId", owner),
        )
        .unique();
      await ctx.db.delete(seat!._id);
    });
    expect(await read()).toBe(false);
  });
});
