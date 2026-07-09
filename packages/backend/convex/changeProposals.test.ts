import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Member-side proposal lifecycle: propose (approved-only, one open per member+definition),
// edit in place (proposer-only), withdraw (proposer-only). Decisions are covered in
// changeProposalDecisions.test.ts.

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

describe("catalog.proposeDefinitionChange", () => {
  test("requires auth", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await submitApproved(t);
    await expect(
      t.mutation(api.catalog.proposeDefinitionChange.proposeDefinitionChange, {
        puzzleDefinitionId: id,
        title: "X",
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("files a pending proposal with server-derived baseline + outbox event", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const id = await submitApproved(t);

    const proposalId = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      {
        puzzleDefinitionId: id,
        title: "Mountain Vista (Panorama)",
        pieceCount: 500,
        comment: "box says 500",
      },
    );

    const row = await proposalRow(t, proposalId as string);
    expect(row).toMatchObject({
      puzzleDefinitionId: id,
      proposedBy: bob,
      status: "pending",
      comment: "box says 500",
      changes: { title: "Mountain Vista (Panorama)", pieceCount: 500 },
      baseline: { title: "Mountain Vista", pieceCount: 1000 },
    });
    expect(await outboxNames(t)).toContain("ChangeProposalFiled");
  });

  test("rejects proposals against non-approved definitions with DefinitionNotProposable", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const pendingId = await asAlice(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Still Pending", pieceCount: 500 },
    );
    await expectConvexCode(
      asBob(t).mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        { puzzleDefinitionId: pendingId as string, title: "X" },
      ),
      "DefinitionNotProposable",
    );
  });

  test("enforces one open proposal per member+definition with OpenProposalAlreadyExists", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const id = await submitApproved(t);
    await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: id, title: "X" },
    );
    await expectConvexCode(
      asBob(t).mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        { puzzleDefinitionId: id, brand: "Ravensburger" },
      ),
      "OpenProposalAlreadyExists",
    );
  });
});

describe("catalog.editChangeProposal / withdrawChangeProposal", () => {
  const fileAsBob = async (t: ReturnType<typeof convexTest>) => {
    const id = await submitApproved(t);
    const proposalId = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: id, title: "First idea" },
    );
    return { definitionId: id, proposalId: proposalId as string };
  };

  test("only the proposer may edit (others get Forbidden)", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await expect(
      asAlice(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
        changeProposalId: proposalId,
        title: "Hijacked",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("edit replaces the diff and re-derives the baseline", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);

    await asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
      changeProposalId: proposalId,
      pieceCount: 500,
      comment: "recount",
    });

    const row = await proposalRow(t, proposalId);
    expect(row).toMatchObject({
      status: "pending",
      comment: "recount",
      changes: { pieceCount: 500 },
      baseline: { pieceCount: 1000 },
    });
    expect(await outboxNames(t)).toContain("ChangeProposalEdited");
  });

  test("only the proposer may withdraw; withdrawal is terminal + re-filing allowed", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);

    await expect(
      asAlice(t).mutation(
        api.catalog.withdrawChangeProposal.withdrawChangeProposal,
        { changeProposalId: proposalId },
      ),
    ).rejects.toThrow(/Forbidden/);

    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    expect((await proposalRow(t, proposalId))?.status).toBe("withdrawn");
    expect(await outboxNames(t)).toContain("ChangeProposalWithdrawn");

    // A withdrawn proposal no longer blocks a fresh one.
    const again = await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "Second idea" },
    );
    expect(again).toBeTruthy();

    // Editing the withdrawn proposal fails with the domain code.
    await expectConvexCode(
      asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
        changeProposalId: proposalId,
        title: "Zombie",
      }),
      "ProposalNotPending",
    );
  });
});
