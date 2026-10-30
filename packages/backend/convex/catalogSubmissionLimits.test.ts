import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Catalogue submissions and change proposals are bounded (SEC-26): their text is capped in the
// domain (CATALOG_TEXT_LIMITS), so no definition or proposal grows to the size of a document.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const seedMember = (
  t: TestConvex<typeof schema>,
  clerkId: string,
  role?: string,
) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      role,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

const asMember = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });
const asAdmin = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId, metadata: { role: "admin" } });

// convex-test may hand ConvexError.data over as a JSON string; normalise.
const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ConvexError)) throw error;
    const data = (error as ConvexError<Value>).data;
    return (typeof data === "string" ? JSON.parse(data) : data) as {
      code?: string;
      retryAfterMs?: number;
    };
  }
  throw new Error("expected a refusal");
};

const puzzleRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("puzzles").collect());
const proposalRows = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("puzzleChangeProposals").collect());

// An approved definition (submitted by an admin, which auto-approves), by aggregateId.
const approvedDefinition = async (t: TestConvex<typeof schema>) => {
  await seedMember(t, "clerk_admin", "admin");
  return (await asAdmin(t, "clerk_admin").mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  )) as string;
};

describe("catalogue text bounds", () => {
  test("a submission with a 200 KB description is TextTooLong and stores nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");

    const refusal = await refusalOf(
      asMember(t, "clerk_alice").mutation(
        api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
        {
          title: "Junk",
          pieceCount: 1000,
          description: "x".repeat(200_000),
        },
      ),
    );

    expect(refusal.code).toBe("TextTooLong");
    expect(await puzzleRows(t)).toEqual([]);
  });

  test("a submission with 500 tags is TextTooLong", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");

    const refusal = await refusalOf(
      asMember(t, "clerk_alice").mutation(
        api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
        {
          title: "Junk",
          pieceCount: 1000,
          tags: Array.from({ length: 500 }, (_, i) => `tag${i}`),
        },
      ),
    );

    expect(refusal.code).toBe("TextTooLong");
    expect(await puzzleRows(t)).toEqual([]);
  });

  test("a proposal with a 100 KB comment is TextTooLong and files nothing", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    await seedMember(t, "clerk_bob");

    const refusal = await refusalOf(
      asMember(t, "clerk_bob").mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        {
          puzzleDefinitionId: definitionId,
          title: "Spam",
          comment: "c".repeat(100_000),
        },
      ),
    );

    expect(refusal.code).toBe("TextTooLong");
    expect(await proposalRows(t)).toEqual([]);
  });

  test("editing a proposal to an over-long comment is TextTooLong and keeps the old comment", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    await seedMember(t, "clerk_bob");
    const proposalId = (await asMember(t, "clerk_bob").mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "Better", comment: "typo" },
    )) as string;

    const refusal = await refusalOf(
      asMember(t, "clerk_bob").mutation(
        api.catalog.editChangeProposal.editChangeProposal,
        {
          changeProposalId: proposalId,
          title: "Better",
          comment: "c".repeat(2_001),
        },
      ),
    );

    expect(refusal.code).toBe("TextTooLong");
    expect((await proposalRows(t)).map((row) => row.comment)).toEqual(["typo"]);
  });

  test("a definition stored with a long description before the bounds can still be updated", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");
    const definitionId = (await asMember(t, "clerk_alice").mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Old Faithful", pieceCount: 1000 },
    )) as string;
    const legacyDescription = "d".repeat(20_000);
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("puzzles").collect();
      if (row) await ctx.db.patch(row._id, { description: legacyDescription });
    });

    await asMember(t, "clerk_alice").mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, pieceCount: 1500 },
    );

    const [row] = await puzzleRows(t);
    expect(row?.pieceCount).toBe(1500);
    expect(row?.description).toBe(legacyDescription);
  });
});
