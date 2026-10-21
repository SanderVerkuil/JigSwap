import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Circle permission levels gate exchange requests. The REQUESTER's level counts, and any route that
// allows it is enough: a public profile with an open copy, household, mutual follow, or a circle
// holding the share where the requester is Exchange or Admin. A ViewOnly seat on its own lets them
// see the copy but not request it. Accept re-checks only the requester's circle standing, and only
// when the request rested on it; the owner's own later changes never block it. The other actions
// stay open.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Level = "ViewOnly" | "Exchange" | "Admin";

const NOW = 1_000_000;

const mkUser = (ctx: MutationCtx, clerkId: string) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name: clerkId,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });

// A PRIVATE owner with one copy for sale (aggregateId "copy-1") and a requester with no route yet.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const owner = await mkUser(ctx, "clerk_owner");
    const requester = await mkUser(ctx, "clerk_requester");
    await ctx.db.insert("profiles", {
      memberId: owner,
      displayName: "Owner",
      visibility: "private",
      updatedAt: NOW,
    });
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
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
      availability: { forTrade: false, forSale: true, forLend: false },
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { owner, requester, copy };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

// A circle owned by the copy's owner, with the requester seated at `level`, holding the copy share.
const shareInCircle = (t: T, s: Seeded, circleId: string, level: Level) =>
  t.run(async (ctx) => {
    await ctx.db.insert("circles", {
      aggregateId: circleId,
      ownerId: s.owner,
      name: circleId,
      memberships: [
        {
          id: `${circleId}-m0`,
          memberId: s.owner,
          permission: "Admin",
          joinedAt: NOW,
        },
        {
          id: `${circleId}-m1`,
          memberId: s.requester,
          permission: level,
          joinedAt: NOW,
        },
      ],
      createdAt: NOW,
    });
    for (const memberId of [s.owner, s.requester]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: circleId,
        memberId,
      });
    }
    await ctx.db.insert("circleCopyShares", {
      circleId,
      copyId: "copy-1",
      sharedAt: NOW,
    });
  });

const setLevel = (t: T, s: Seeded, circleId: string, level: Level) =>
  t.run(async (ctx) => {
    const circle = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .unique();
    await ctx.db.patch(circle!._id, {
      memberships: circle!.memberships.map((m) =>
        m.memberId === s.requester ? { ...m, permission: level } : m,
      ),
    });
  });

const followMutually = (t: T, s: Seeded) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: s.owner,
      followeeId: s.requester,
      createdAt: NOW,
    });
    await ctx.db.insert("follows", {
      followerId: s.requester,
      followeeId: s.owner,
      createdAt: NOW,
    });
  });

const shareHousehold = (t: T, s: Seeded) =>
  t.run(async (ctx) => {
    await ctx.db.insert("households", { aggregateId: "hh-1", createdAt: NOW });
    for (const [memberId, role] of [
      [s.owner, "admin"],
      [s.requester, "member"],
    ] as const) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh-1",
        memberId,
        role,
        joinedAt: NOW,
      });
    }
  });

const asRequester = (t: T) => t.withIdentity({ subject: "clerk_requester" });
const asOwner = (t: T) => t.withIdentity({ subject: "clerk_owner" });

const propose = (t: T, s: Seeded) =>
  asRequester(t).mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: s.copy,
    salePrice: 10,
  });

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

const statusOf = (t: T, exchangeId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
          .unique()
      )?.status,
  );

describe("propose by circle level", () => {
  test("ViewOnly is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "ViewOnly");
    await expectCode(propose(t, s), "NotPermittedInCircle");
    expect(await t.run((ctx) => ctx.db.query("exchanges").collect())).toEqual(
      [],
    );
  });

  test.each(["Exchange", "Admin"] as const)("%s is allowed", async (level) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", level);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("ViewOnly in one circle and Exchange in another is allowed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "ViewOnly");
    await shareInCircle(t, s, "c2", "Exchange");
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("ViewOnly plus a mutual follow is allowed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "ViewOnly");
    await followMutually(t, s);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });

  test("ViewOnly plus a household is allowed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "ViewOnly");
    await shareHousehold(t, s);
    await expect(propose(t, s)).resolves.toEqual(expect.any(String));
  });
});

describe("a downgrade after proposing", () => {
  test("blocks accept, leaves the proposal open and lets the requester cancel", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await setLevel(t, s, "c1", "ViewOnly");

    await expectCode(
      asOwner(t).mutation(api.exchange.accept.accept, { exchangeId: id }),
      "NotPermittedInCircle",
    );
    expect(await statusOf(t, id)).toBe("proposed");

    await asRequester(t).mutation(api.exchange.cancel.cancel, {
      exchangeId: id,
    });
    expect(await statusOf(t, id)).toBe("cancelled");
  });

  test("does not stop an accepted exchange from completing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await asOwner(t).mutation(api.exchange.accept.accept, { exchangeId: id });
    await setLevel(t, s, "c1", "ViewOnly");

    for (const who of [asRequester(t), asOwner(t)]) {
      await who.mutation(api.exchange.confirmCompletion.confirmCompletion, {
        exchangeId: id,
      });
    }
    expect(await statusOf(t, id)).toBe("completed");
  });
});

const rowOf = (t: T, exchangeId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
      .unique(),
  );

const setOwnerVisibility = (
  t: T,
  s: Seeded,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", s.owner))
      .unique();
    await ctx.db.patch(profile!._id, { visibility });
  });

// The requester leaves: both the circle's membership list and the junction row go.
const leaveCircle = (t: T, s: Seeded, circleId: string) =>
  t.run(async (ctx) => {
    const circle = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .unique();
    await ctx.db.patch(circle!._id, {
      memberships: circle!.memberships.filter(
        (m) => m.memberId !== s.requester,
      ),
    });
    const link = await ctx.db
      .query("circleMembers")
      .withIndex("by_circle_member", (q) =>
        q.eq("circleAggregateId", circleId).eq("memberId", s.requester),
      )
      .unique();
    await ctx.db.delete(link!._id);
  });

// A row proposed before `eligibleVia` was recorded.
const dropEligibleVia = (t: T, exchangeId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
      .unique();
    await ctx.db.patch(row!._id, { eligibleVia: undefined });
  });

const accept = (t: T, id: string) =>
  asOwner(t).mutation(api.exchange.accept.accept, { exchangeId: id });

describe("eligibleVia recorded on propose", () => {
  test("direct for a public owner, even with an Exchange circle seat too", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await setOwnerVisibility(t, s, "public");
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    expect((await rowOf(t, id))?.eligibleVia).toBe("direct");
  });

  test("circle when only a circle seat allows it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    expect((await rowOf(t, id))?.eligibleVia).toBe("circle");
  });
});

describe("accept after the owner changes their side", () => {
  test("a direct-route request stays acceptable after the owner goes private", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await setOwnerVisibility(t, s, "public");
    const id = await propose(t, s);
    await setOwnerVisibility(t, s, "private");

    await accept(t, id);
    expect(await statusOf(t, id)).toBe("accepted");
  });
});

describe("accept on a circle-route request", () => {
  test("is refused once the requester left the circle", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await leaveCircle(t, s, "c1");

    await expectCode(accept(t, id), "NotPermittedInCircle");
    expect(await statusOf(t, id)).toBe("proposed");
  });

  test("is refused on a ViewOnly demotion even if the owner turned public since", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await setLevel(t, s, "c1", "ViewOnly");
    await setOwnerVisibility(t, s, "public");

    await expectCode(accept(t, id), "NotPermittedInCircle");
  });

  test("succeeds when demoted in one circle but still Exchange in another holding the share", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    await shareInCircle(t, s, "c2", "Exchange");
    const id = await propose(t, s);
    await setLevel(t, s, "c1", "ViewOnly");

    await accept(t, id);
    expect(await statusOf(t, id)).toBe("accepted");
  });
});

describe("accept on a request without eligibleVia (proposed before it was recorded)", () => {
  test("succeeds on a non-circle route now, without any circle seat", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await dropEligibleVia(t, id);
    await leaveCircle(t, s, "c1");
    await followMutually(t, s);

    await accept(t, id);
    expect(await statusOf(t, id)).toBe("accepted");
  });

  test("falls back to the circle check: refused after a demotion", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await dropEligibleVia(t, id);
    await setLevel(t, s, "c1", "ViewOnly");

    await expectCode(accept(t, id), "NotPermittedInCircle");
  });

  test("falls back to the circle check: accepted while the seat holds", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    const id = await propose(t, s);
    await dropEligibleVia(t, id);

    await accept(t, id);
    expect(await statusOf(t, id)).toBe("accepted");
  });
});

describe("viewerMayRequest on the copy and browse views", () => {
  const views = async (t: T, s: Seeded) => {
    const instance = await asRequester(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.copy },
    );
    const browse = await asRequester(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    );
    return {
      instance: instance?.viewerMayRequest,
      browse: browse.ownedPuzzles.find((c) => c._id === s.copy)
        ?.viewerMayRequest,
    };
  };

  test("false for a ViewOnly seat", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "ViewOnly");
    expect(await views(t, s)).toEqual({ instance: false, browse: false });
  });

  test("true for an Exchange seat", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await shareInCircle(t, s, "c1", "Exchange");
    expect(await views(t, s)).toEqual({ instance: true, browse: true });
  });

  test("false for the owner", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const instance = await asOwner(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.copy },
    );
    expect(instance?.viewerMayRequest).toBe(false);
  });
});
