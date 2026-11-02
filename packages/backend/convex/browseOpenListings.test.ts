import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  BROWSE_MAX_LIMIT,
  BROWSE_PAGE_READ_BUDGET,
} from "./library/browseOwnedPuzzles";
import { CIRCLE_SHARES_READ_PER_CIRCLE } from "./library/circleSharedCopies";
import schema from "./schema";

// Browse's candidate source (PERF-B1m, SEC-29): open copies are read newest offer first from the
// listing indexes, by cursor and only as far as a page needs, so one member's pile of older listings
// can't hide newer ones, closed copies and private members' copies are never read, and rows written
// before the listing fields existed (no `isOpen`) are still found by their availability until
// library/backfillCopyOpenFlag has run. One member's pile of NEWER listings can push others down a
// page, never out of reach: every row is one more Load more away.
//
// convex-test blind spot: rows dropped by a native `.filter()` are not counted as reads, so a
// documentsRead limit can't show what a full-table `.filter()` costs in a deployment. The bounded
// read test below therefore also checks that a row FLAGGED closed is never read at all.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type Avail = Doc<"ownedPuzzles">["availability"];
const OPEN: Avail = { forTrade: true, forSale: false, forLend: false };
const CLOSED: Avail = { forTrade: false, forSale: false, forLend: false };
const BASE = 1_700_000_000_000;

type Flag = "flagged" | "legacy";

// The viewer (bob) and two other public members, plus two definitions.
const seedWorld = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const insertUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: BASE,
        updatedAt: BASE,
      });
    const bob = await insertUser("clerk_bob");
    const alice = await insertUser("clerk_alice");
    const mallory = await insertUser("clerk_mallory");
    const insertPuzzle = (title: string) =>
      ctx.db.insert("puzzles", {
        aggregateId: crypto.randomUUID(),
        title,
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        createdAt: BASE,
        updatedAt: BASE,
      });
    const vista = await insertPuzzle("Mountain Vista");
    const harbour = await insertPuzzle("Harbour Lights");
    return { bob, alice, mallory, vista, harbour };
  });

type CopySpec = {
  ownerId: Id<"users">;
  puzzleId: Id<"puzzles">;
  createdAt: number;
  availability?: Avail;
  // Absent: a legacy row written before the flag existed.
  isOpen?: boolean;
  // When it was offered; a flagged open row defaults to `createdAt`, as written by a save.
  listedAt?: number;
  // The owner's profile is private, as stamped by a save or the visibility sync.
  ownerPrivate?: true;
};

const insertCopies = (t: TestConvex<typeof schema>, specs: CopySpec[]) =>
  t.run(async (ctx) => {
    const ids: Id<"ownedPuzzles">[] = [];
    for (const spec of specs) {
      ids.push(
        await ctx.db.insert("ownedPuzzles", {
          aggregateId: crypto.randomUUID(),
          puzzleId: spec.puzzleId,
          ownerId: spec.ownerId,
          condition: "good",
          availability: spec.availability ?? OPEN,
          ...(spec.isOpen === undefined ? {} : { isOpen: spec.isOpen }),
          ...(spec.isOpen === true && {
            listedAt: spec.listedAt ?? spec.createdAt,
          }),
          ...(spec.ownerPrivate && { ownerPrivate: true as const }),
          createdAt: spec.createdAt,
          updatedAt: spec.createdAt,
        }),
      );
    }
    return ids;
  });

// `count` open copies of one owner, oldest first, flagged or legacy.
const openCopies = (
  count: number,
  base: Omit<CopySpec, "createdAt">,
  start: number,
  flag: Flag,
): CopySpec[] =>
  Array.from({ length: count }, (_, i) => ({
    ...base,
    createdAt: start + i,
    ...(flag === "flagged" ? { isOpen: true } : {}),
  }));

const browseAsBob = (
  t: TestConvex<typeof schema>,
  args: Record<string, unknown> = {},
) =>
  t
    .withIdentity({ subject: "clerk_bob" })
    .query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, args);

const idsOf = (view: { ownedPuzzles: { _id: string }[] }) =>
  view.ownedPuzzles.map((c) => c._id);

// A circle with these members seated, the first its owner.
const insertCircle = async (
  ctx: MutationCtx,
  aggregateId: string,
  members: Id<"users">[],
) => {
  await ctx.db.insert("circles", {
    aggregateId,
    name: aggregateId,
    ownerId: members[0],
    memberships: members.map((memberId, i) => ({
      id: `${aggregateId}-seat-${i}`,
      memberId,
      permission: "ViewOnly" as const,
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

// Every row Browse reaches for these filters, page by page, as Load more walks them.
const walkAsBob = async (
  t: TestConvex<typeof schema>,
  args: Record<string, unknown> = {},
) => {
  const rows: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    pages += 1;
    const view: Awaited<ReturnType<typeof browseAsBob>> = await browseAsBob(t, {
      limit: BROWSE_MAX_LIMIT,
      ...args,
      cursor,
    });
    rows.push(...idsOf(view));
    if (!view.hasMore) return { rows, pages };
    expect(view.continueCursor).not.toBeNull();
    cursor = view.continueCursor;
  }
};

describe.each<Flag>(["flagged", "legacy"])(
  "Browse lists the newest open copies first (%s rows)",
  (flag) => {
    test("500 older open copies of one member can't hide a newer listing (SEC-29)", async () => {
      const t = convexTest(schema, modules);
      const { alice, mallory, vista, harbour } = await seedWorld(t);
      await insertCopies(
        t,
        openCopies(500, { ownerId: mallory, puzzleId: harbour }, BASE, flag),
      );
      const [aliceCopy] = await insertCopies(
        t,
        openCopies(1, { ownerId: alice, puzzleId: vista }, BASE + 10_000, flag),
      );

      const view = await browseAsBob(t, { limit: BROWSE_MAX_LIMIT });
      expect(idsOf(view)[0]).toBe(aliceCopy);
      expect(view.hasMore).toBe(true);
      expect((await walkAsBob(t)).rows).toHaveLength(501);

      const forVista = await browseAsBob(t, { puzzleId: vista });
      expect(idsOf(forVista)).toEqual([aliceCopy]);
    });

    test("closed copies are never listed", async () => {
      const t = convexTest(schema, modules);
      const { alice, vista } = await seedWorld(t);
      await insertCopies(t, [
        {
          ownerId: alice,
          puzzleId: vista,
          createdAt: BASE + 1,
          availability: CLOSED,
          ...(flag === "flagged" ? { isOpen: false } : {}),
        },
      ]);
      const [open] = await insertCopies(
        t,
        openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, flag),
      );

      expect(idsOf(await browseAsBob(t))).toEqual([open]);
      expect(idsOf(await browseAsBob(t, { puzzleId: vista }))).toEqual([open]);
    });
  },
);

// A member with a profile row (alice, bob and mallory have none: absent means public).
const insertMember = (
  t: TestConvex<typeof schema>,
  name: string,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      isActive: true,
      createdAt: BASE,
      updatedAt: BASE,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: name,
      visibility,
      updatedAt: BASE,
    });
    return id;
  });

describe("no one member can put others out of reach (SEC-29)", () => {
  test("a private and a public member with 1,000 newer open copies each can't hide an older public listing", async () => {
    const t = convexTest(schema, modules);
    const { alice, mallory, vista, harbour } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    // Interleaved, all newer than alice's listing.
    const flood: CopySpec[] = [];
    for (let i = 0; i < 1000; i++) {
      for (const ownerId of [carol, mallory]) {
        flood.push({
          ownerId,
          puzzleId: harbour,
          createdAt: BASE + 10 + flood.length,
          isOpen: true,
        });
      }
    }
    await insertCopies(t, flood);

    // Mallory's copies and then alice's; carol's are never shown.
    const { rows } = await walkAsBob(t);
    expect(rows).toHaveLength(1001);
    expect(rows.slice(-1)).toEqual([aliceCopy]);

    // Every filter reaches it too. Reading stops at each page's budget, and Load more carries on.
    const search = await walkAsBob(t, { searchTerm: "mountain" });
    expect(search.rows).toEqual([aliceCopy]);
    expect(search.pages).toBeGreaterThan(1);
    const forVista = await browseAsBob(t, { puzzleId: vista });
    expect(idsOf(forVista)).toEqual([aliceCopy]);
  });

  test("copies the viewer can't see never take a slot: own, blocked, other condition", async () => {
    const t = convexTest(schema, modules);
    const { bob, alice, mallory, vista, harbour } = await seedWorld(t);
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    await insertCopies(t, [
      ...openCopies(
        BROWSE_PAGE_READ_BUDGET,
        { ownerId: bob, puzzleId: harbour },
        BASE + 10,
        "flagged",
      ),
      ...openCopies(
        BROWSE_PAGE_READ_BUDGET,
        { ownerId: mallory, puzzleId: harbour },
        BASE + 5_000,
        "flagged",
      ),
    ]);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: mallory,
        createdAt: BASE,
      }),
    );

    const { rows } = await walkAsBob(t);
    expect(rows).toEqual([aliceCopy]);
  });

  test("a private member's copies are never read, however many", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 300 },
    });
    const { alice, vista, harbour } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    await insertCopies(
      t,
      openCopies(
        BROWSE_PAGE_READ_BUDGET + 10,
        { ownerId: carol, puzzleId: harbour, ownerPrivate: true },
        BASE + 10,
        "flagged",
      ),
    );

    const view = await browseAsBob(t);
    expect(idsOf(view)).toEqual([aliceCopy]);
    expect(view.hasMore).toBe(false);
  });

  test("a flood not yet marked private (before the backfill) costs a page its read budget, and Load more carries on", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: BROWSE_PAGE_READ_BUDGET + 100 },
    });
    const { alice, vista, harbour } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    await insertCopies(
      t,
      openCopies(
        BROWSE_PAGE_READ_BUDGET + 10,
        { ownerId: carol, puzzleId: harbour },
        BASE + 10,
        "flagged",
      ),
    );

    const view = await browseAsBob(t);
    expect(view.ownedPuzzles).toEqual([]);
    expect(view.hasMore).toBe(true);
    const next = await browseAsBob(t, { cursor: view.continueCursor });
    expect(idsOf(next)).toEqual([aliceCopy]);
    expect(next.hasMore).toBe(false);
  });

  test("the definition view counts an older public listing past a marked private member's pile", async () => {
    const t = convexTest(schema, modules);
    const { alice, vista } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    await insertCopies(
      t,
      openCopies(
        1000,
        { ownerId: carol, puzzleId: vista, ownerPrivate: true },
        BASE + 10,
        "flagged",
      ),
    );

    const view = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
        puzzleId: vista,
      });
    expect(view?.totalAvailable).toBe(1);
    expect(view?.availableCopies.map((c) => c.copyId)).toEqual([aliceCopy]);
  });

  test("the definition view counts an older public listing past a private member's pile", async () => {
    const t = convexTest(schema, modules);
    const { alice, vista } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const [aliceCopy] = await insertCopies(
      t,
      openCopies(1, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
    await insertCopies(
      t,
      openCopies(
        250,
        { ownerId: carol, puzzleId: vista },
        BASE + 10,
        "flagged",
      ),
    );

    const view = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
        puzzleId: vista,
      });
    expect(view?.totalAvailable).toBe(1);
    expect(view?.availableCopies.map((c) => c.copyId)).toEqual([aliceCopy]);
  });
});

describe("Browse lists the newest offers first", () => {
  test("an old copy offered today leads, for all copies, per definition and in the definition view", async () => {
    const t = convexTest(schema, modules);
    const { alice, mallory, vista } = await seedWorld(t);
    const mallorys = await insertCopies(
      t,
      openCopies(
        3,
        { ownerId: mallory, puzzleId: vista },
        BASE + 100,
        "flagged",
      ),
    );
    // Added long before mallory's copies, offered after them.
    const [aliceCopy] = await insertCopies(t, [
      {
        ownerId: alice,
        puzzleId: vista,
        createdAt: BASE,
        isOpen: true,
        listedAt: BASE + 10_000,
      },
    ]);
    const expected = [aliceCopy, ...[...mallorys].reverse()];

    expect(idsOf(await browseAsBob(t))).toEqual(expected);
    expect(idsOf(await browseAsBob(t, { puzzleId: vista }))).toEqual(expected);
    const view = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
        puzzleId: vista,
      });
    expect(view?.availableCopies.map((c) => c.copyId)).toEqual(expected);
  });
});

describe("Browse merges flagged and legacy rows", () => {
  test("rows with and without the flag interleave newest-first, for all copies and per definition", async () => {
    const t = convexTest(schema, modules);
    const { alice, mallory, vista, harbour } = await seedWorld(t);
    // Alternate flagged and legacy rows, with legacy closed rows in between.
    const specs: CopySpec[] = [];
    for (let i = 0; i < 8; i++) {
      specs.push({
        ownerId: i % 2 === 0 ? alice : mallory,
        puzzleId: i < 4 ? vista : harbour,
        createdAt: BASE + i * 10,
        ...(i % 2 === 0 ? { isOpen: true } : {}),
      });
      specs.push({
        ownerId: alice,
        puzzleId: vista,
        createdAt: BASE + i * 10 + 5,
        availability: CLOSED,
      });
    }
    const ids = await insertCopies(t, specs);
    const openIds = ids.filter((_, i) => i % 2 === 0);

    expect(idsOf(await browseAsBob(t))).toEqual([...openIds].reverse());
    expect(idsOf(await browseAsBob(t, { puzzleId: vista }))).toEqual(
      openIds.slice(0, 4).reverse(),
    );
  });
});

describe("Browse reads a bounded window", () => {
  test("thousands of closed copies are never read (all copies and per definition)", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 300 },
    });
    const { alice, vista } = await seedWorld(t);
    const closed: CopySpec[] = Array.from({ length: 2_000 }, (_, i) => ({
      ownerId: alice,
      puzzleId: vista,
      createdAt: BASE + 100 + i,
      availability: CLOSED,
      isOpen: false,
    }));
    // A row whose flag says closed is not a candidate, whatever its availability says: Browse never
    // reads the closed range (library/backfillCopyOpenFlag repairs such drift).
    closed.push({
      ownerId: alice,
      puzzleId: vista,
      createdAt: BASE + 5_000,
      availability: OPEN,
      isOpen: false,
    });
    await insertCopies(t, closed);
    const open = await insertCopies(
      t,
      openCopies(3, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );

    const all = await browseAsBob(t);
    expect(idsOf(all)).toEqual([...open].reverse());
    expect(all.hasMore).toBe(false);
    const forVista = await browseAsBob(t, { puzzleId: vista });
    expect(idsOf(forVista)).toEqual([...open].reverse());
  });

  // Seeds `count` open copies, each by its own owner, of its own definition, with box art: the most
  // a row can cost. Newest last.
  const seedManyOwners = async (
    t: TestConvex<typeof schema>,
    count: number,
    fields: Partial<Doc<"ownedPuzzles">> = {},
    visibility?: "public" | "private",
  ) => {
    const image = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/webp" })),
    );
    for (let start = 0; start < count; start += 200) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(count, start + 200); i++) {
          const ownerId = await ctx.db.insert("users", {
            clerkId: `clerk_owner_${i}`,
            email: `owner${i}@example.com`,
            name: `owner ${i}`,
            isActive: true,
            createdAt: BASE,
            updatedAt: BASE,
          });
          if (visibility) {
            await ctx.db.insert("profiles", {
              memberId: ownerId,
              displayName: `owner ${i}`,
              visibility,
              updatedAt: BASE,
            });
          }
          const puzzleId = await ctx.db.insert("puzzles", {
            title: `Puzzle ${i}`,
            pieceCount: 500,
            status: "approved",
            image,
            submittedBy: ownerId,
            createdAt: BASE,
            updatedAt: BASE,
          });
          await ctx.db.insert("ownedPuzzles", {
            aggregateId: `copy-${i}`,
            puzzleId,
            ownerId,
            condition: "good",
            availability: OPEN,
            isOpen: true,
            listedAt: BASE + i,
            createdAt: BASE + i,
            updatedAt: BASE + i,
            ...fields,
          });
        }
      });
    }
  };

  test("a page reads what it shows: 1,200 owners and definitions cost no more than one page's rows", async () => {
    const t = convexTest({
      schema,
      modules,
      // A page's 48 rows, one more to see there is more, and what the cards join: well under the
      // about 3,000 documents a run read when it built its whole window first.
      transactionLimits: { documentsRead: 200 },
    });
    await seedWorld(t);
    await seedManyOwners(t, 1200);

    const view = await browseAsBob(t, { limit: 48 });
    expect(view.ownedPuzzles).toHaveLength(48);
    expect(view.hasMore).toBe(true);

    const next = await browseAsBob(t, {
      limit: 48,
      cursor: view.continueCursor,
    });
    expect(next.ownedPuzzles).toHaveLength(48);
    expect(idsOf(next).some((id) => idsOf(view).includes(id))).toBe(false);
  }, 300_000);

  test("a filter that matches nothing stops at its budget, under Convex's real limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await seedWorld(t);
    await seedManyOwners(t, BROWSE_PAGE_READ_BUDGET + 50);

    const view = await browseAsBob(t, { searchTerm: "no such puzzle" });
    expect(view.ownedPuzzles).toEqual([]);
    expect(view.hasMore).toBe(true);

    const next = await browseAsBob(t, {
      searchTerm: "no such puzzle",
      cursor: view.continueCursor,
    });
    expect(next.ownedPuzzles).toEqual([]);
    expect(next.hasMore).toBe(false);
  }, 300_000);

  test("private owners not yet marked cost a lookup each, and hold under Convex's real limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await seedWorld(t);
    await seedManyOwners(t, BROWSE_PAGE_READ_BUDGET + 50, {}, "private");

    const view = await browseAsBob(t, { minPieceCount: 1 });
    expect(view.ownedPuzzles).toEqual([]);
    expect(view.hasMore).toBe(true);
  }, 300_000);

  test("a member of many busy circles can still browse, under Convex's real limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { bob, alice, vista } = await seedWorld(t);
    const CIRCLES = 12;
    for (let c = 0; c < CIRCLES; c++) {
      await t.run(async (ctx) => {
        const circleAggregateId = `circle-${c}`;
        await insertCircle(ctx, circleAggregateId, [alice, bob]);
        for (let i = 0; i < CIRCLE_SHARES_READ_PER_CIRCLE; i++) {
          const copyId = `circle-copy-${c}-${i}`;
          await ctx.db.insert("ownedPuzzles", {
            aggregateId: copyId,
            puzzleId: vista,
            ownerId: alice,
            condition: "good",
            availability: OPEN,
            isOpen: true,
            listedAt: BASE + i,
            createdAt: BASE + i,
            updatedAt: BASE + i,
          });
          await ctx.db.insert("circleCopyShares", {
            circleId: circleAggregateId,
            copyId,
            sharedAt: BASE + i,
          });
        }
      });
    }

    const view = await browseAsBob(t, { limit: BROWSE_MAX_LIMIT });
    expect(view.ownedPuzzles).toHaveLength(BROWSE_MAX_LIMIT);
  }, 300_000);
});

describe("Browse's cursor", () => {
  const seedMany = async (t: TestConvex<typeof schema>, count = 150) => {
    const { alice, vista } = await seedWorld(t);
    return insertCopies(
      t,
      openCopies(count, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
  };

  test(`limit is clamped to 1..${BROWSE_MAX_LIMIT}`, async () => {
    const t = convexTest(schema, modules);
    await seedMany(t);
    expect((await browseAsBob(t, { limit: 1_000 })).ownedPuzzles).toHaveLength(
      BROWSE_MAX_LIMIT,
    );
    expect((await browseAsBob(t, { limit: 0 })).ownedPuzzles).toHaveLength(1);
    expect((await browseAsBob(t, { limit: -5 })).ownedPuzzles).toHaveLength(1);
    expect((await browseAsBob(t)).ownedPuzzles).toHaveLength(20);
  });

  test("pages reach every row once, newest first, and only the last says there is no more", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedMany(t);
    const { rows, pages } = await walkAsBob(t);
    expect(rows).toEqual([...ids].reverse());
    expect(pages).toBe(3);
  });

  test("a page holding exactly the last rows has nothing to offer after it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedMany(t, BROWSE_MAX_LIMIT);
    const view = await browseAsBob(t, { limit: BROWSE_MAX_LIMIT });
    expect(idsOf(view)).toEqual([...ids].reverse());
    expect(view.hasMore).toBe(false);
    expect(view.continueCursor).toBeNull();
  });

  test("copies listed at the same moment are all reached across a page boundary", async () => {
    const t = convexTest(schema, modules);
    const { alice, vista } = await seedWorld(t);
    const ids = await insertCopies(
      t,
      Array.from({ length: 7 }, () => ({
        ownerId: alice,
        puzzleId: vista,
        createdAt: BASE,
        isOpen: true,
        listedAt: BASE,
      })),
    );
    const { rows } = await walkAsBob(t, { limit: 3 });
    expect([...rows].sort()).toEqual([...ids].sort());
    expect(rows).toHaveLength(7);
  });

  test("a new listing doesn't shift a page already read: the next page carries on from its cursor", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedMany(t, 10);
    const { alice, vista } = await t.run(async (ctx) => {
      const copy = (await ctx.db.get(ids[0]))!;
      return { alice: copy.ownerId, vista: copy.puzzleId };
    });
    const first = await browseAsBob(t, { limit: 4 });

    await insertCopies(t, [
      { ownerId: alice, puzzleId: vista, createdAt: BASE + 100, isOpen: true },
    ]);

    const next = await browseAsBob(t, {
      limit: 4,
      cursor: first.continueCursor,
    });
    expect([...idsOf(first), ...idsOf(next)]).toEqual(ids.slice(-8).reverse());
  });

  test.each(["not json", "42", "null", "[]", '{"flagged":"x","sortKey":[1]}'])(
    "an unreadable cursor (%s) reads from the top instead of failing",
    async (cursor) => {
      const t = convexTest(schema, modules);
      const ids = await seedMany(t, 3);
      const view = await browseAsBob(t, { cursor });
      expect(idsOf(view)).toEqual([...ids].reverse());
    },
  );

  test("rows with no listing time sit below the timed ones and are all reached", async () => {
    const t = convexTest(schema, modules);
    const { alice, vista } = await seedWorld(t);
    const timed = await insertCopies(
      t,
      openCopies(3, { ownerId: alice, puzzleId: vista }, BASE + 100, "flagged"),
    );
    // Flagged open by an earlier run of the backfill, before it set `listedAt`.
    const untimed = await t.run(async (ctx) => {
      const out: Id<"ownedPuzzles">[] = [];
      for (let i = 0; i < 3; i++) {
        out.push(
          await ctx.db.insert("ownedPuzzles", {
            aggregateId: crypto.randomUUID(),
            puzzleId: vista,
            ownerId: alice,
            condition: "good",
            availability: OPEN,
            isOpen: true,
            createdAt: BASE + i,
            updatedAt: BASE + i,
          }),
        );
      }
      return out;
    });

    const { rows } = await walkAsBob(t, { limit: 2 });
    expect(rows).toEqual([...[...timed].reverse(), ...[...untimed].reverse()]);
  });

  test("legacy rows page by cursor too, closed ones counted against the budget", async () => {
    const t = convexTest(schema, modules);
    const { alice, mallory, vista } = await seedWorld(t);
    const specs: CopySpec[] = [];
    for (let i = 0; i < 20; i++) {
      specs.push({
        ownerId: i % 2 === 0 ? alice : mallory,
        puzzleId: vista,
        createdAt: BASE + i * 10,
        ...(i % 3 === 0 ? { isOpen: true } : {}),
      });
      specs.push({
        ownerId: alice,
        puzzleId: vista,
        createdAt: BASE + i * 10 + 5,
        availability: CLOSED,
      });
    }
    const ids = await insertCopies(t, specs);
    const openIds = ids.filter((_, i) => i % 2 === 0);

    const { rows } = await walkAsBob(t, { limit: 3 });
    expect(rows).toEqual([...openIds].reverse());
  });
});

describe("circle-shared copies in Browse's pages", () => {
  // A private member's open copies shared into a circle the viewer is in, interleaved in time with
  // a public member's listings.
  const seedCircle = async (t: TestConvex<typeof schema>) => {
    const { bob, alice, vista } = await seedWorld(t);
    const carol = await insertMember(t, "carol", "private");
    const specs: CopySpec[] = [];
    for (let i = 0; i < 12; i++) {
      specs.push({
        ownerId: i % 2 === 0 ? alice : carol,
        puzzleId: vista,
        createdAt: BASE + i,
        isOpen: true,
        ...(i % 2 === 0 ? {} : { ownerPrivate: true as const }),
      });
    }
    const ids = await insertCopies(t, specs);
    await t.run(async (ctx) => {
      await insertCircle(ctx, "circle-1", [carol, bob, alice]);
      // Every copy, so a public member's appears through the index and the circle both.
      for (const id of ids) {
        const copy = (await ctx.db.get(id))!;
        await ctx.db.insert("circleCopyShares", {
          circleId: "circle-1",
          copyId: copy.aggregateId!,
          sharedAt: BASE,
        });
      }
    });
    return ids;
  };

  test.each([1, 2, 3, 5, 12])(
    "pages of %i keep the merged order, with every copy once",
    async (limit) => {
      const t = convexTest(schema, modules);
      const ids = await seedCircle(t);
      const { rows } = await walkAsBob(t, { limit });
      expect(rows).toEqual([...ids].reverse());
    },
  );

  test("a private member's copy stays out once the viewer has left the circle", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedCircle(t);
    await t.run(async (ctx) => {
      const links = await ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle", (q) => q.eq("circleId", "circle-1"))
        .collect();
      for (const link of links) await ctx.db.delete(link._id);
    });
    const { rows } = await walkAsBob(t, { limit: 3 });
    // Only the public member's (even indexes), through the index.
    expect(rows).toEqual(ids.filter((_, i) => i % 2 === 0).reverse());
  });
});
