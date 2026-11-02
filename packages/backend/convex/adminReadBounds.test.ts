import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
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
