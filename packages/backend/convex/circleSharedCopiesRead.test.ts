import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { CIRCLE_SHARED_COPIES_LIMIT } from "./sharing/listCircleSharedCopies";

// sharing/listCircleSharedCopies (G6b): the circle page's shared puzzles. Members only, with one
// generic CircleNotFound for everyone else; every card passes canViewCopy; private copies, stale
// shares (the owner left) and copies of a blocked member never show. Every profile is PRIVATE and
// nobody follows anybody, so only the circle share can reveal a copy.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const NONE = { forTrade: false, forSale: false, forLend: false };
const OPEN = { ...NONE, forTrade: true };

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: clerkId,
      visibility: "private",
      updatedAt: now,
    });
    return id;
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

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

const listAs = (t: T, clerkId: string, circleId: string) =>
  as(t, clerkId).query(
    api.sharing.listCircleSharedCopies.listCircleSharedCopies,
    { circleId },
  );

// A copy of `title` owned by `ownerId`, shared into `circleId` at `sharedAt`.
const shareCopy = (
  t: T,
  circleId: string,
  ownerId: Id<"users">,
  title: string,
  sharedAt: number,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: `def-${title}`,
      title,
      pieceCount: 1000,
      status: "approved",
      submittedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = `copy-${title}`;
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyId,
      puzzleId,
      ownerId,
      condition: "good",
      availability: OPEN,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    await ctx.db.insert("circleCopyShares", { circleId, copyId, sharedAt });
  });

// Alice owns "Puzzle Club"; Bob and Carol are members; Dave is outside it.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const memberId of [bob, carol]) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission: "ViewOnly",
    });
  }
  return { alice, bob, carol, dave, circleId };
};

describe("listCircleSharedCopies", () => {
  test("a member sees the circle's shared copies, newest share first, as cards", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, circleId } = await seed(t);
    await shareCopy(t, circleId, alice, "Lighthouse", 1);
    await shareCopy(t, circleId, carol, "Wasgij", 2);

    const cards = await listAs(t, "bob", circleId);
    expect(cards.map((c) => c.title)).toEqual(["Wasgij", "Lighthouse"]);
    expect(cards[0]).toMatchObject({ brand: null, pieceCount: 1000 });
    expect(typeof cards[0].copyId).toBe("string");
  });

  test("a non-member, an unknown circle and an ex-member all get the same CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    await shareCopy(t, circleId, alice, "Lighthouse", 1);

    await expectCode(listAs(t, "dave", circleId), "CircleNotFound");
    await expectCode(listAs(t, "dave", "no-such-circle"), "CircleNotFound");

    await as(t, "alice").mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });
    await expectCode(listAs(t, "bob", circleId), "CircleNotFound");
  });

  test("a private copy shared into the circle is left out, even for its owner", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    await shareCopy(t, circleId, alice, "Secret", 1, {
      availability: NONE,
      visibility: "private",
      visibilityAuthoritative: true,
    });
    await shareCopy(t, circleId, alice, "Lighthouse", 2);

    expect((await listAs(t, "bob", circleId)).map((c) => c.title)).toEqual([
      "Lighthouse",
    ]);
    expect((await listAs(t, "alice", circleId)).map((c) => c.title)).toEqual([
      "Lighthouse",
    ]);
  });

  test("a copy whose owner left the circle is left out (a stale share exposes nothing)", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    await shareCopy(t, circleId, carol, "Wasgij", 1);
    // Bob and Carol follow each other, so Bob may still view the copy itself: only the
    // current-member check keeps it off the circle's page.
    await t.run(async (ctx) => {
      for (const [followerId, followeeId] of [
        [bob, carol],
        [carol, bob],
      ]) {
        await ctx.db.insert("follows", {
          followerId,
          followeeId,
          createdAt: Date.now(),
        });
      }
    });
    // Leaving withdraws Carol's shares; re-insert one to model a stale row left behind.
    await as(t, "carol").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle_copy", (q) =>
          q.eq("circleId", circleId).eq("copyId", "copy-Wasgij"),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("circleCopyShares", {
          circleId,
          copyId: "copy-Wasgij",
          sharedAt: 1,
        });
      }
    });

    expect(await listAs(t, "bob", circleId)).toEqual([]);
  });

  test("a copy of a member who deleted their account is left out", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId } = await seed(t);
    await shareCopy(t, circleId, carol, "Wasgij", 1);
    // Account deletion tombstones the user row but (for now) keeps the circle seat.
    await t.run((ctx) => ctx.db.patch(carol, { isActive: false }));

    expect(await listAs(t, "bob", circleId)).toEqual([]);
  });

  test("a copy of a member blocked either way is left out (canViewCopy)", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    await shareCopy(t, circleId, carol, "Wasgij", 1);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: carol,
        blockedId: bob,
        createdAt: Date.now(),
      }),
    );

    expect(await listAs(t, "bob", circleId)).toEqual([]);
    expect((await listAs(t, "alice", circleId)).map((c) => c.title)).toEqual([
      "Wasgij",
    ]);
  });

  test("a non-open copy shows only to whoever may view it otherwise (the circle clause needs an open copy)", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    await shareCopy(t, circleId, alice, "Closed", 1, { availability: NONE });

    expect(await listAs(t, "bob", circleId)).toEqual([]);
    expect((await listAs(t, "alice", circleId)).map((c) => c.title)).toEqual([
      "Closed",
    ]);
  });

  test("returns at most the page's limit", async () => {
    const t = convexTest(schema, modules);
    const { alice, circleId } = await seed(t);
    for (let i = 0; i < CIRCLE_SHARED_COPIES_LIMIT + 2; i++) {
      await shareCopy(t, circleId, alice, `P${i}`, i);
    }

    const cards = await listAs(t, "bob", circleId);
    expect(cards).toHaveLength(CIRCLE_SHARED_COPIES_LIMIT);
    expect(cards[0].title).toBe(`P${CIRCLE_SHARED_COPIES_LIMIT + 1}`);
  });
});
