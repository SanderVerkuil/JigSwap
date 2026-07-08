import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// End-to-end invariants of the reversible disable lifecycle, exercised through the REAL
// mutations: a disabled definition disappears from every public browse/search surface and
// cannot be newly acquired by other members, while existing owned copies (cached snapshots)
// are untouched. Re-enabling restores public visibility and acquirability.

const seedMembers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Alice submits, admin approves. Returns the aggregateId.
const seedApprovedDefinition = async (t: ReturnType<typeof convexTest>) => {
  const id = (await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", brand: "Ravensburger", pieceCount: 1000 },
  )) as string;
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id },
  );
  return id;
};

const disable = (t: ReturnType<typeof convexTest>, id: string) =>
  asAdmin(t).mutation(
    api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
    { puzzleDefinitionId: id },
  );

const reenable = (t: ReturnType<typeof convexTest>, id: string) =>
  asAdmin(t).mutation(
    api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
    { puzzleDefinitionId: id },
  );

const browseTitles = async (t: ReturnType<typeof convexTest>) => {
  const result = await t.query(api.catalog.listAllPuzzles.listAllPuzzles, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  return result.page.map((p) => p.title);
};

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

describe("disabled definitions leave every public surface", () => {
  test("browse (listAllPuzzles) hides a disabled definition and shows it again after re-enable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    expect(await browseTitles(t)).toEqual(["Mountain Vista"]);
    await disable(t, id);
    expect(await browseTitles(t)).toEqual([]);
    await reenable(t, id);
    expect(await browseTitles(t)).toEqual(["Mountain Vista"]);
  });

  test("search suggestions (search-index filter) hide a disabled definition", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    const before = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "mountain" },
    );
    expect(before.map((p) => p.title)).toEqual(["Mountain Vista"]);

    await disable(t, id);
    const after = await t.query(
      api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
      { searchTerm: "mountain" },
    );
    expect(after).toEqual([]);
  });

  test("getPuzzleById discloses a disabled definition only to its submitter or an admin", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);
    await disable(t, id);

    const puzzleId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id))
        .unique();
      return row!._id;
    });

    expect(
      await asBob(t).query(api.catalog.getPuzzleById.getPuzzleById, {
        puzzleId,
      }),
    ).toBeNull();
    expect(
      await asAlice(t).query(api.catalog.getPuzzleById.getPuzzleById, {
        puzzleId,
      }),
    ).not.toBeNull(); // submitter keeps visibility of their own submission
  });
});

describe("acquisition ACL", () => {
  test("another member cannot acquire a disabled definition (PuzzleNotAcquirable), but can after re-enable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);
    await disable(t, id);

    await expectConvexCode(
      asBob(t).mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: id,
        condition: "good",
      }),
      "PuzzleNotAcquirable",
    );

    await reenable(t, id);
    const copyId = await asBob(t).mutation(
      api.library.acquireCopy.acquireCopy,
      {
        puzzleDefinitionId: id,
        condition: "good",
      },
    );
    expect(typeof copyId).toBe("string");
  });

  test("existing owned copies are untouched by disable (cached snapshot keeps rendering)", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await seedApprovedDefinition(t);

    // Bob acquires BEFORE the disable.
    const copyId = (await asBob(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: id, condition: "good" },
    )) as string;

    await disable(t, id);

    const copy = await t.run(async (ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );
    expect(copy).not.toBeNull();
    expect(copy?.snapshot).toMatchObject({
      title: "Mountain Vista",
      pieceCount: 1000,
    });
  });
});
