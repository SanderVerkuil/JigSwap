import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { BROWSE_CANDIDATE_CAP } from "./library/browseOwnedPuzzles";
import schema from "./schema";

// Browse's candidate source (PERF-B1m, SEC-29): open copies are read newest-first from the
// `isOpen` indexes, so one member's pile of older listings can't hide newer ones, closed copies are
// never read, and rows written before the flag existed (no `isOpen`) are still found by their
// availability until library/backfillCopyOpenFlag has run.
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

      const view = await browseAsBob(t, { limit: 100 });
      expect(idsOf(view)[0]).toBe(aliceCopy);
      expect(view.total).toBe(501);
      expect(view.hasMore).toBe(true);
      expect(view.totalIsLowerBound).toBe(false);

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
    expect(all.total).toBe(3);
    const forVista = await browseAsBob(t, { puzzleId: vista });
    expect(idsOf(forVista)).toEqual([...open].reverse());
  });

  test(`past ${BROWSE_CANDIDATE_CAP} open copies the total is a lower bound and the newest stay listed`, async () => {
    const t = convexTest(schema, modules);
    const { alice, vista } = await seedWorld(t);
    const ids = await insertCopies(
      t,
      openCopies(
        BROWSE_CANDIDATE_CAP + 5,
        { ownerId: alice, puzzleId: vista },
        BASE,
        "flagged",
      ),
    );

    const view = await browseAsBob(t, { limit: 100 });
    expect(view.totalIsLowerBound).toBe(true);
    expect(view.total).toBe(BROWSE_CANDIDATE_CAP);
    expect(idsOf(view)).toEqual(ids.slice(-100).reverse());
  });

  test("a full window of distinct owners and definitions stays inside Convex's limits", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await seedWorld(t);
    await t.run(async (ctx) => {
      for (let i = 0; i <= BROWSE_CANDIDATE_CAP; i++) {
        const ownerId = await ctx.db.insert("users", {
          clerkId: `clerk_owner_${i}`,
          email: `owner${i}@example.com`,
          name: `owner ${i}`,
          isActive: true,
          createdAt: BASE,
          updatedAt: BASE,
        });
        const puzzleId = await ctx.db.insert("puzzles", {
          title: `Puzzle ${i}`,
          pieceCount: 500,
          status: "approved",
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
          createdAt: BASE + i,
          updatedAt: BASE + i,
        });
      }
    });

    const view = await browseAsBob(t, { limit: 100 });
    expect(view.ownedPuzzles).toHaveLength(100);
    expect(view.totalIsLowerBound).toBe(true);
  });
});

describe("Browse paging arguments", () => {
  const seedMany = async (t: TestConvex<typeof schema>) => {
    const { alice, vista } = await seedWorld(t);
    return insertCopies(
      t,
      openCopies(150, { ownerId: alice, puzzleId: vista }, BASE, "flagged"),
    );
  };

  test("limit is clamped to 1..100", async () => {
    const t = convexTest(schema, modules);
    await seedMany(t);
    expect((await browseAsBob(t, { limit: 1_000 })).ownedPuzzles).toHaveLength(
      100,
    );
    expect((await browseAsBob(t, { limit: 0 })).ownedPuzzles).toHaveLength(1);
    expect((await browseAsBob(t, { limit: -5 })).ownedPuzzles).toHaveLength(1);
    expect((await browseAsBob(t)).ownedPuzzles).toHaveLength(20);
  });

  test("offset pages through the window without gaps or repeats", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedMany(t);
    const pages = [];
    for (const offset of [0, 50, 100]) {
      pages.push(await browseAsBob(t, { limit: 50, offset }));
    }
    expect(pages.map((p) => p.hasMore)).toEqual([true, true, false]);
    expect(pages.every((p) => p.total === 150)).toBe(true);
    expect(pages.flatMap(idsOf)).toEqual([...ids].reverse());

    const negative = await browseAsBob(t, { limit: 5, offset: -10 });
    expect(idsOf(negative)).toEqual(ids.slice(-5).reverse());
  });
});
