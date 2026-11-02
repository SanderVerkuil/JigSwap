import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_DEFINITION_PROPOSALS } from "./catalog/listProposalsForDefinition";
import schema from "./schema";

// Admin reads a free account can grow past what one function may read. Withdrawing a proposal keeps
// its row and copies are added at 500 a day, so one member could break the very pages used to find
// them. These tests run under a read limit well below what the member wrote.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const READ_LIMIT = 900;

type T = TestConvex<typeof schema>;
let t: T;
let member: Id<"users">;
let puzzleId: Id<"puzzles">;
const asAdmin = () =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

beforeEach(async () => {
  t = convexTest({
    schema,
    modules,
    transactionLimits: { documentsRead: READ_LIMIT },
  });
  ({ member, puzzleId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      clerkId: "clerk_admin",
      email: "admin@example.com",
      name: "Admin",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const member = await ctx.db.insert("users", {
      clerkId: "clerk_member",
      email: "member@example.com",
      name: "Member",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: "definition_1",
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: member,
      createdAt: 1,
      updatedAt: 1,
    });
    return { member, puzzleId };
  }));
});

describe("catalog/listProposalsForDefinition", () => {
  const seedProposals = (count: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("puzzleChangeProposals", {
          aggregateId: `proposal_${i}`,
          puzzleDefinitionId: "definition_1",
          proposedBy: member,
          status: "withdrawn",
          changes: { title: `Title ${i}` },
          baseline: { title: "Starry Night" },
          createdAt: i + 1,
          updatedAt: i + 1,
        });
      }
    });
  const read = () =>
    asAdmin().query(
      api.catalog.listProposalsForDefinition.listProposalsForDefinition,
      { puzzleDefinitionId: "definition_1" },
    );

  test("reads the newest ones and says there are more", async () => {
    await seedProposals(READ_LIMIT + 50);
    const { proposals, capped } = await read();
    expect(capped).toBe(true);
    expect(proposals).toHaveLength(MAX_DEFINITION_PROPOSALS);
    expect(proposals[0]?.aggregateId).toBe(`proposal_${READ_LIMIT + 49}`);
  });

  test("doesn't say so when they all fit", async () => {
    await seedProposals(MAX_DEFINITION_PROPOSALS);
    const { proposals, capped } = await read();
    expect(capped).toBe(false);
    expect(proposals).toHaveLength(MAX_DEFINITION_PROPOSALS);
  });
});

describe("the member and definition lists", () => {
  // More copies of one definition by one member than the read limit, under a counter row and totals
  // as the writes that added them keep them.
  const seedCopies = () =>
    t.run(async (ctx) => {
      for (let i = 0; i < READ_LIMIT + 50; i++) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: member,
          heldBy: member,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          createdAt: 1,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("memberLibraryCounts", {
        memberId: member,
        owned: READ_LIMIT + 50,
        forTrade: 0,
      });
    });
  const stored = (ownerCount: number | undefined) =>
    t.run((ctx) =>
      ctx.db.insert("definitionStats", {
        puzzleId,
        computedAt: 1,
        totals: {
          ratingCount: 0,
          ratingSum: 0,
          breakdown: [0, 0, 0, 0, 0],
          completedCount: 0,
          finishDaysSum: 0,
          finishDaysCount: 0,
          communityOwners: 0,
          ownerCount,
          publicAvailable: { swap: 0, lend: 0, sale: 0 },
        },
      }),
    );

  test("listUsers reads a member's size from the counter", async () => {
    await seedCopies();
    const { page } = await asAdmin().query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 25, cursor: null },
    });
    const row = page.find((user) => user._id === member);
    expect(row?.ownedCopyCount).toBe(READ_LIMIT + 50);
  });

  test("listUsers counts a member without a counter yet", async () => {
    await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: member,
        heldBy: member,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const { page } = await asAdmin().query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(page.find((user) => user._id === member)?.ownedCopyCount).toBe(1);
  });

  test("listUsers doesn't call a counter row a lower bound", async () => {
    await seedCopies();
    const { page } = await asAdmin().query(api.admin.listUsers.listUsers, {
      paginationOpts: { numItems: 25, cursor: null },
    });
    const row = page.find((user) => user._id === member);
    expect(row?.ownedCopyCountIsLowerBound).toBeUndefined();
  });

  test("listPuzzleDefinitions says when a count from the bounded scan may be short", async () => {
    await seedCopies();
    await stored(undefined);
    const { page } = await asAdmin().query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      { paginationOpts: { numItems: 25, cursor: null } },
    );
    expect(page[0]?.ownerCountIsLowerBound).toBe(true);
  });

  test("listPuzzleDefinitions counts a definition with few copies exactly before its totals have the count", async () => {
    await t.run((ctx) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: member,
        heldBy: member,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const { page } = await asAdmin().query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      { paginationOpts: { numItems: 25, cursor: null } },
    );
    expect(page[0]?.ownerCount).toBe(1);
    expect(page[0]?.ownerCountIsLowerBound).toBeUndefined();
  });

  test("listPuzzleDefinitions doesn't call a stored count a lower bound", async () => {
    await seedCopies();
    await stored(1);
    const { page } = await asAdmin().query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      { paginationOpts: { numItems: 25, cursor: null } },
    );
    expect(page[0]?.ownerCountIsLowerBound).toBeUndefined();
  });

  test("listPuzzleDefinitions reads a definition's owners from its totals", async () => {
    await seedCopies();
    await stored(1);
    const { page } = await asAdmin().query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      { paginationOpts: { numItems: 25, cursor: null } },
    );
    expect(page[0]?.ownerCount).toBe(1);
  });

  test("listPuzzleDefinitions stays within the read limit before the totals have the count", async () => {
    await seedCopies();
    await stored(undefined);
    const { page } = await asAdmin().query(
      api.admin.listPuzzleDefinitions.listPuzzleDefinitions,
      { paginationOpts: { numItems: 25, cursor: null } },
    );
    expect(page[0]?.ownerCount).toBe(1);
  });

  test("a recompute writes every owner into the count, private copies included", async () => {
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("users", {
        clerkId: "clerk_other",
        email: "other@example.com",
        name: "Other",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      for (const [ownerId, visibility] of [
        [member, "visible"],
        [other, "private"],
      ] as const) {
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId,
          heldBy: ownerId,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          visibility,
          visibilityAuthoritative: true,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    await t.mutation(internal.library.definitionStats.recompute, { puzzleId });
    const row = await t.run((ctx) =>
      ctx.db
        .query("definitionStats")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
        .unique(),
    );
    expect(row?.totals?.ownerCount).toBe(2);
    expect(row?.totals?.communityOwners).toBe(1);
  });

  test("a row from before the count isn't logged as drift when its recompute fills it", async () => {
    await stored(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t.mutation(internal.library.definitionStats.recompute, { puzzleId });
    expect(
      log.mock.calls.filter(([line]) => String(line).includes("drift")),
    ).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("admin/getPuzzleDefinitionDetail", () => {
  test("reads a bounded number of copies and says when it stopped", async () => {
    t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 2200 },
    });
    const seeded = await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "clerk_admin",
        email: "admin@example.com",
        name: "Admin",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const owner = await ctx.db.insert("users", {
        clerkId: "clerk_owner",
        email: "owner@example.com",
        name: "Owner",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const definition = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        submittedBy: owner,
        createdAt: 1,
        updatedAt: 1,
      });
      return { owner, definition };
    });
    for (let batch = 0; batch < 3; batch++) {
      await t.run(async (ctx) => {
        for (let i = 0; i < 1000; i++) {
          await ctx.db.insert("ownedPuzzles", {
            puzzleId: seeded.definition,
            ownerId: seeded.owner,
            heldBy: seeded.owner,
            condition: "good",
            availability: { forTrade: false, forSale: false, forLend: false },
            createdAt: 1,
            updatedAt: 1,
          });
        }
      });
    }
    const { stats } = await asAdmin().query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: seeded.definition },
    );
    expect(stats.capped).toBe(true);
    expect(stats.copies.total).toBe(2000);
    expect(stats.ownerCount).toBe(1);
  });
});
