import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Admin-side proposal decisions: approve (atomic, patches the definition) and reject (definition
// untouched). Member-side lifecycle is covered in changeProposals.test.ts.

const seedMembers = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice", "Alice"),
      bob: await mkUser("clerk_bob", "Bob"),
    };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

// Submit + approve, returning an APPROVED definition's aggregateId.
const submitApproved = async (t: ReturnType<typeof convexTest>) => {
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id as string },
  );
  return id as string;
};

const proposalRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

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

const puzzleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

const fileAsBob = async (t: ReturnType<typeof convexTest>) => {
  const definitionId = await submitApproved(t);
  const proposalId = await asBob(t).mutation(
    api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    {
      puzzleDefinitionId: definitionId,
      title: "Mountain Vista (Panorama)",
      pieceCount: 500,
    },
  );
  return { definitionId, proposalId: proposalId as string };
};

describe("catalog.approveChangeProposal", () => {
  test("is admin-gated", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await expect(
      t.mutation(api.catalog.approveChangeProposal.approveChangeProposal, {
        changeProposalId: proposalId,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asBob(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        {
          changeProposalId: proposalId,
        },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("atomically approves the proposal AND applies the patch, stamps proposal_approved, appends both outbox events", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );

    expect((await proposalRow(t, proposalId))?.status).toBe("approved");
    const puzzle = await puzzleRow(t, definitionId);
    expect(puzzle?.title).toBe("Mountain Vista (Panorama)");
    expect(puzzle?.pieceCount).toBe(500);

    const names = await outboxNames(t);
    expect(names).toContain("ChangeProposalApproved");
    expect(names).toContain("PuzzleDefinitionUpdated");

    const actions = await allActions(t);
    const stamp = actions.find((a) => a.kind === "proposal_approved");
    expect(stamp).toMatchObject({
      actorId: alice,
      targetId: definitionId,
      targetLabel: "Mountain Vista (Panorama)",
    });
  });

  test("cannot approve twice (IllegalProposalTransition), patch not double-applied", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        { changeProposalId: proposalId },
      ),
      "IllegalProposalTransition",
    );
  });
});

describe("catalog.rejectChangeProposal", () => {
  test("rejects with reason, leaves the definition untouched, stamps proposal_rejected", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "title matches the box" },
    );

    const row = await proposalRow(t, proposalId);
    expect(row?.status).toBe("rejected");
    expect(row?.rejectionReason).toBe("title matches the box");
    expect((await puzzleRow(t, definitionId))?.title).toBe("Mountain Vista");

    const actions = await allActions(t);
    expect(actions.some((a) => a.kind === "proposal_rejected")).toBe(true);
    expect(await outboxNames(t)).toContain("ChangeProposalRejected");
  });

  test("a rejected proposal cannot be approved afterwards", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId },
    );
    await expectConvexCode(
      asAdmin(t).mutation(
        api.catalog.approveChangeProposal.approveChangeProposal,
        { changeProposalId: proposalId },
      ),
      "IllegalProposalTransition",
    );
  });
});
