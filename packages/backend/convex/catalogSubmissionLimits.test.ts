import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Catalogue submissions and change proposals are bounded (SEC-26): their text is capped in the
// domain (CATALOG_TEXT_LIMITS), so no definition or proposal grows to the size of a document, and
// each member has hourly and daily buckets for submissions (RATE_LIMITS.catalogSubmit 10,
// catalogSubmitDaily 20) and for filed proposals (proposalFile 10, proposalFileDaily 30), since
// every one notifies each admin. Admins, who seed the catalogue, are exempt.

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

const seedBucket = (t: TestConvex<typeof schema>, key: string, count: number) =>
  t.run((ctx) =>
    ctx.db.insert("rateLimits", { key, windowStart: Date.now(), count }),
  );

const buckets = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) =>
    Object.fromEntries(
      (await ctx.db.query("rateLimits").collect()).map((row) => [
        row.key,
        row.count,
      ]),
    ),
  );

// Drain the async event dispatcher (the admin fan-out runs in a scheduled job).
const flushScheduled = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const adminNotifications = (
  t: TestConvex<typeof schema>,
  admin: Id<"users">,
  type: string,
) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", admin))
        .collect()
    ).filter((n) => n.type === type),
  );

const submitAs = (
  t: TestConvex<typeof schema>,
  clerkId: string,
  title: string,
) =>
  asMember(t, clerkId).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title, pieceCount: 1000 },
  );

describe("submitPuzzleDefinition: per-member limit", () => {
  test("each submission is charged to the member's hourly and daily buckets", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t, "clerk_alice");

    await submitAs(t, "clerk_alice", "First");

    expect(await buckets(t)).toEqual({
      [`catalogSubmit:${alice}`]: 1,
      [`catalogSubmitDaily:${alice}`]: 1,
    });
  });

  test("the 11th submission in an hour is RateLimited and stores nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");
    for (let i = 0; i < 10; i++) await submitAs(t, "clerk_alice", `P${i}`);

    const refusal = await refusalOf(submitAs(t, "clerk_alice", "Eleventh"));

    expect(refusal.code).toBe("RateLimited");
    expect(refusal.retryAfterMs).toBeGreaterThan(0);
    expect(await puzzleRows(t)).toHaveLength(10);
  });

  test("the 21st submission in a day is RateLimited, with no row and no admin notification", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedMember(t, "clerk_admin", "admin");
    const alice = await seedMember(t, "clerk_alice");
    await seedBucket(t, `catalogSubmitDaily:${alice}`, 20);

    const refusal = await refusalOf(submitAs(t, "clerk_alice", "Junk"));
    await flushScheduled(t);

    expect(refusal.code).toBe("RateLimited");
    expect(await puzzleRows(t)).toEqual([]);
    expect(
      await adminNotifications(t, admin, "admin_definition_submitted"),
    ).toEqual([]);
    // The refusal wrote nothing, not even the hourly bucket.
    expect(await buckets(t)).toEqual({ [`catalogSubmitDaily:${alice}`]: 20 });
  });

  test("a refused submission (invalid input) does not use up the budget", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, "clerk_alice");

    await refusalOf(
      asMember(t, "clerk_alice").mutation(
        api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
        { title: "Junk", pieceCount: 1000, description: "x".repeat(6_000) },
      ),
    );

    expect(await buckets(t)).toEqual({});
  });

  test("an admin is exempt", async () => {
    const t = convexTest(schema, modules);
    const admin = await seedMember(t, "clerk_admin", "admin");
    await seedBucket(t, `catalogSubmit:${admin}`, 10);
    await seedBucket(t, `catalogSubmitDaily:${admin}`, 20);

    await asAdmin(t, "clerk_admin").mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Seeded", pieceCount: 1000 },
    );

    expect(await puzzleRows(t)).toHaveLength(1);
  });
});

describe("proposeDefinitionChange: per-member limit", () => {
  const propose = (
    t: TestConvex<typeof schema>,
    clerkId: string,
    puzzleDefinitionId: string,
    title: string,
  ) =>
    t
      .withIdentity({ subject: clerkId })
      .mutation(api.catalog.proposeDefinitionChange.proposeDefinitionChange, {
        puzzleDefinitionId,
        title,
      });

  test("withdraw and re-file stops at the hourly cap", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    await seedMember(t, "clerk_bob");
    for (let i = 0; i < 10; i++) {
      const proposalId = (await propose(
        t,
        "clerk_bob",
        definitionId,
        `Spam ${i}`,
      )) as string;
      await asMember(t, "clerk_bob").mutation(
        api.catalog.withdrawChangeProposal.withdrawChangeProposal,
        { changeProposalId: proposalId },
      );
    }

    const refusal = await refusalOf(
      propose(t, "clerk_bob", definitionId, "Spam 10"),
    );

    expect(refusal.code).toBe("RateLimited");
    expect(await proposalRows(t)).toHaveLength(10);
  });

  test("the 31st proposal in a day is RateLimited, with no row and no admin notification", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    const admin2 = await seedMember(t, "clerk_admin2", "admin");
    const bob = await seedMember(t, "clerk_bob");
    await seedBucket(t, `proposalFileDaily:${bob}`, 30);

    const refusal = await refusalOf(
      propose(t, "clerk_bob", definitionId, "Spam"),
    );
    await flushScheduled(t);

    expect(refusal.code).toBe("RateLimited");
    expect(await proposalRows(t)).toEqual([]);
    expect(await adminNotifications(t, admin2, "admin_proposal_filed")).toEqual(
      [],
    );
  });

  test("each filed proposal is charged; editing it in place is not", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    const bob = await seedMember(t, "clerk_bob");
    const proposalId = (await propose(
      t,
      "clerk_bob",
      definitionId,
      "Better",
    )) as string;
    await asMember(t, "clerk_bob").mutation(
      api.catalog.editChangeProposal.editChangeProposal,
      { changeProposalId: proposalId, title: "Better still" },
    );

    expect(await buckets(t)).toEqual({
      [`proposalFile:${bob}`]: 1,
      [`proposalFileDaily:${bob}`]: 1,
    });
  });

  test("an admin is exempt", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    const admin = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_admin"))
            .unique()
        )?._id,
    );
    await seedBucket(t, `proposalFile:${admin}`, 10);
    await seedBucket(t, `proposalFileDaily:${admin}`, 30);

    await asAdmin(t, "clerk_admin").mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "Admin fix" },
    );

    expect(await proposalRows(t)).toHaveLength(1);
  });
});

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

    // Only an admin edits a definition directly; everyone else files a change proposal.
    await seedMember(t, "clerk_admin", "admin");
    await asAdmin(t, "clerk_admin").mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, pieceCount: 1500 },
    );

    const [row] = await puzzleRows(t);
    expect(row?.pieceCount).toBe(1500);
    expect(row?.description).toBe(legacyDescription);
  });

  test("approving a suggestion filed with over-long text before the bounds is TextTooLong and applies nothing", async () => {
    const t = convexTest(schema, modules);
    const definitionId = await approvedDefinition(t);
    await seedMember(t, "clerk_bob");
    await asMember(t, "clerk_bob").mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "Better" },
    );
    // A proposal stored before the bounds existed.
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("puzzleChangeProposals").collect();
      if (row) {
        await ctx.db.patch(row._id, {
          changes: { ...row.changes, description: "d".repeat(20_000) },
        });
      }
    });
    const [proposal] = await proposalRows(t);

    const refusal = await refusalOf(
      asAdmin(t, "clerk_admin").mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        { changeProposalId: proposal!.aggregateId },
      ),
    );

    expect(refusal.code).toBe("TextTooLong");
    const [row] = await puzzleRows(t);
    expect(row?.title).toBe("Mountain Vista");
    expect(row?.description).toBeUndefined();
    expect((await proposalRows(t)).map((p) => p.status)).toEqual(["pending"]);
  });
});
