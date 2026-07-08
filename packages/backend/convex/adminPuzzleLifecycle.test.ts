import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Reversible disable lifecycle: an admin disables an approved definition (hiding it from
// public surfaces) and can re-enable it. Each mutation is admin-gated, flips ONLY the status,
// stamps one append-only moderationActions row, and appends the domain event to the durable
// outbox. Nothing is deleted.

// Seed a single member; the Clerk subject maps to the user via by_clerk_id.
const seedMember = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Alice submits a pending definition, returning the aggregateId.
const submitPending = async (t: ReturnType<typeof convexTest>) => {
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  return id as string;
};

// Submit + approve, returning an APPROVED definition's aggregateId.
const submitApproved = async (t: ReturnType<typeof convexTest>) => {
  const id = await submitPending(t);
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id },
  );
  return id;
};

const puzzleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

const outboxNames = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("domainEvents").collect()).map((e) => e.name),
  );

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

describe("catalog.disablePuzzleDefinition", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);

    await expect(
      t.mutation(api.catalog.disablePuzzleDefinition.disablePuzzleDefinition, {
        puzzleDefinitionId: id,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).mutation(
        api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("flips approved → disabled, stamps definition_disabled, appends the outbox event", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitApproved(t);

    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const row = await puzzleRow(t, id);
    expect(row?.status).toBe("disabled");

    // Audit rows are append-only: the approve stamp is still there, plus the new one.
    const actions = await allActions(t);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toMatchObject({
      actorId: alice,
      kind: "definition_disabled",
      targetLabel: "Mountain Vista",
      targetId: id,
    });

    expect(await outboxNames(t)).toContain("PuzzleDefinitionDisabled");
  });

  test("disabling a PENDING definition is an illegal transition and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitPending(t);

    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
      "IllegalApprovalTransition",
    );
    expect(await allActions(t)).toHaveLength(0);
    expect((await puzzleRow(t, id))?.status).toBe("pending");
  });
});

describe("catalog.reenablePuzzleDefinition", () => {
  test("is admin-gated: unauthenticated and non-admin members are rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);
    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    await expect(
      t.mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asAlice(t).mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("flips disabled → approved, stamps definition_reenabled, appends the outbox event", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitApproved(t);
    await asAdmin(t).mutation(
      api.catalog.disablePuzzleDefinition.disablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    await asAdmin(t).mutation(
      api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const row = await puzzleRow(t, id);
    expect(row?.status).toBe("approved");

    const actions = await allActions(t);
    expect(actions).toHaveLength(3); // approve + disable + reenable, append-only
    expect(actions[2]).toMatchObject({
      actorId: alice,
      kind: "definition_reenabled",
      targetLabel: "Mountain Vista",
      targetId: id,
    });

    expect(await outboxNames(t)).toContain("PuzzleDefinitionReenabled");
  });

  test("re-enabling a definition that is not disabled is an illegal transition and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitApproved(t);

    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.reenablePuzzleDefinition.reenablePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
      "IllegalApprovalTransition",
    );
    expect(await allActions(t)).toHaveLength(1); // only the approve stamp
    expect((await puzzleRow(t, id))?.status).toBe("approved");
  });
});

describe("getModerationStats ignores lifecycle toggles", () => {
  test("definition_disabled / definition_reenabled feed no KPI bucket and no review-time sample", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("moderationActions", {
        kind: "definition_disabled",
        targetLabel: "Some Puzzle",
        targetId: "target-1",
        at: now - 1000,
      });
      await ctx.db.insert("moderationActions", {
        kind: "definition_reenabled",
        targetLabel: "Some Puzzle",
        targetId: "target-1",
        at: now - 2000,
      });
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    expect(stats).toMatchObject({
      approved: 0,
      rejected: 0,
      flagsCleared: 0,
    });
    expect(stats.avgReviewMins).toBeNull();
  });
});
