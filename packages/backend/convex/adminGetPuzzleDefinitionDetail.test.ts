import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Alice is the acting admin (JWT claim only). Carol submitted the inspected
// definition ("Mountain Vista", aggregateId def-1). Bob owns two copies (one
// forTrade), Dana one copy (forSale + forLend). Two moderation actions target
// def-1 (approved then disabled) and one targets another definition (must be
// excluded from the trail).
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    const alice = await mkUser("clerk_alice", "Alice");
    const bob = await mkUser("clerk_bob", "Bob");
    const carol = await mkUser("clerk_carol", "Carol");
    const dana = await mkUser("clerk_dana", "Dana");

    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "disabled",
      submittedBy: carol,
      createdAt: now - 1000,
      updatedAt: now,
    });

    const mkCopy = (
      ownerId: typeof bob,
      availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
    ) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });
    await mkCopy(bob, { forTrade: true, forSale: false, forLend: false });
    await mkCopy(bob, { forTrade: false, forSale: false, forLend: false });
    await mkCopy(dana, { forTrade: false, forSale: true, forLend: true });

    await ctx.db.insert("moderationActions", {
      actorId: alice,
      kind: "definition_approved",
      targetLabel: "Mountain Vista",
      targetId: "def-1",
      at: now - 500,
    });
    await ctx.db.insert("moderationActions", {
      actorId: alice,
      kind: "definition_disabled",
      targetLabel: "Mountain Vista",
      targetId: "def-1",
      at: now - 100,
    });
    // Different target — must NOT appear in def-1's trail.
    await ctx.db.insert("moderationActions", {
      actorId: alice,
      kind: "definition_approved",
      targetLabel: "Other Puzzle",
      targetId: "def-other",
      at: now - 50,
    });

    return { alice, bob, carol, dana, puzzle };
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

describe("admin/getPuzzleDefinitionDetail", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await expect(
      t.query(api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail, {
        puzzleId: puzzle,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a member without the JWT admin claim", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await expect(
      asMember(t).query(
        api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
        { puzzleId: puzzle },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("rejects when the definition does not exist (ConvexError, not a crash)", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await t.run((ctx) => ctx.db.delete(puzzle));
    await expect(
      asAdmin(t).query(
        api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
        { puzzleId: puzzle },
      ),
    ).rejects.toThrow(/not found/);
  });

  test("returns definition facts, submitter, and the copies/owner stats", async () => {
    const t = convexTest(schema, modules);
    const { puzzle, carol } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: puzzle },
    );
    expect(result.definition).toMatchObject({
      _id: puzzle,
      aggregateId: "def-1",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "disabled",
      image: null,
      submitter: { _id: carol, name: "Carol" },
    });
    expect(result.stats).toEqual({
      ownerCount: 2,
      copies: { total: 3, forTrade: 1, forSale: 1, forLend: 1 },
    });
  });

  test("groups owners with copy counts and rolled-up availability flags", async () => {
    const t = convexTest(schema, modules);
    const { puzzle, bob, dana } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: puzzle },
    );
    expect(result.owners).toEqual([
      {
        _id: bob,
        name: "Bob",
        username: undefined,
        avatar: undefined,
        copyCount: 2,
        forTrade: true,
        forSale: false,
        forLend: false,
      },
      {
        _id: dana,
        name: "Dana",
        username: undefined,
        avatar: undefined,
        copyCount: 1,
        forTrade: false,
        forSale: true,
        forLend: true,
      },
    ]);
  });

  test("returns the definition's audit trail newest first, scoped to its aggregateId", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: puzzle },
    );
    expect(result.audit.map((row) => row.kind)).toEqual([
      "definition_disabled",
      "definition_approved",
    ]);
    expect(result.audit[0]).toMatchObject({
      actorName: "Alice",
      targetLabel: "Mountain Vista",
      targetId: "def-1",
    });
  });

  test("legacy definition without aggregateId gets an empty audit trail", async () => {
    const t = convexTest(schema, modules);
    const { carol } = await seed(t);
    const legacy = await t.run((ctx) =>
      ctx.db.insert("puzzles", {
        title: "Legacy Harbour",
        pieceCount: 500,
        status: "approved",
        submittedBy: carol,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: legacy },
    );
    expect(result.audit).toEqual([]);
    expect(result.stats).toEqual({
      ownerCount: 0,
      copies: { total: 0, forTrade: 0, forSale: 0, forLend: 0 },
    });
    expect(result.owners).toEqual([]);
  });

  test("includes a proposal_approved row when a change proposal targeting this definition was approved", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asBob = (t: ReturnType<typeof convexTest>) =>
      t.withIdentity({ subject: "clerk_bob" });

    const definitionAggregateId = (await asMember(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Coastal Village", pieceCount: 750 },
    )) as string;
    await asAdmin(t).mutation(
      api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
      { puzzleDefinitionId: definitionAggregateId },
    );
    const proposalId = (await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      {
        puzzleDefinitionId: definitionAggregateId,
        title: "Coastal Village II",
      },
    )) as string;
    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );

    const definitionRow = await t.run((ctx) =>
      ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", definitionAggregateId),
        )
        .unique(),
    );

    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: definitionRow!._id },
    );
    expect(result.audit.some((row) => row.kind === "proposal_approved")).toBe(
      true,
    );
  });

  test("caps the owners list at 50 but counts every distinct owner in stats", async () => {
    const t = convexTest(schema, modules);
    const { puzzle } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 55; i++) {
        const owner = await ctx.db.insert("users", {
          clerkId: `clerk_extra_${i}`,
          email: `extra${i}@example.com`,
          name: `Extra ${i}`,
          searchableName: `extra ${i}`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("ownedPuzzles", {
          puzzleId: puzzle,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: false, forSale: false, forLend: false },
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await asAdmin(t).query(
      api.admin.getPuzzleDefinitionDetail.getPuzzleDefinitionDetail,
      { puzzleId: puzzle },
    );
    expect(result.owners).toHaveLength(50);
    expect(result.stats.ownerCount).toBe(57); // bob + dana + 55 extras
  });
});
