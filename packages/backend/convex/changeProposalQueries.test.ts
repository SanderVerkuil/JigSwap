import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Read models for the change-proposal review flow: the admin pending queue (with derived
// conflict flags), the per-definition history, and the member's own submissions.

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

describe("catalog.listPendingChangeProposals", () => {
  test("is admin-gated", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    await expect(
      t.query(
        api.catalog.listPendingChangeProposals.listPendingChangeProposals,
        {},
      ),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      asBob(t).query(
        api.catalog.listPendingChangeProposals.listPendingChangeProposals,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns pending proposals enriched with definition, proposer, and NO conflict when nothing moved", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { proposalId } = await fileAsBob(t);

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      aggregateId: proposalId,
      definitionTitle: "Mountain Vista",
      proposerName: "Bob",
      hasConflict: false,
      conflictFields: [],
      changes: { title: "Mountain Vista (Panorama)", pieceCount: 500 },
      baseline: { title: "Mountain Vista", pieceCount: 1000 },
      current: { title: "Mountain Vista", pieceCount: 1000 },
    });
  });

  test("derives a conflict marker when the definition moved since the proposal was filed", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId } = await fileAsBob(t);

    // A direct edit lands between filing and review: title now differs from the baseline.
    await asAdmin(t).mutation(
      api.catalog.updatePuzzleDefinition.updatePuzzleDefinition,
      { puzzleDefinitionId: definitionId, title: "Renamed Meanwhile" },
    );

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );
    expect(queue[0]).toMatchObject({
      hasConflict: true,
      conflictFields: ["title"],
      baseline: { title: "Mountain Vista" },
      current: { title: "Renamed Meanwhile", pieceCount: 1000 },
    });
  });

  test("decided proposals leave the queue but stay in listProposalsForDefinition", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);
    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "no" },
    );

    const queue = await asAdmin(t).query(
      api.catalog.listPendingChangeProposals.listPendingChangeProposals,
      {},
    );
    expect(queue).toHaveLength(0);

    const history = await asAdmin(t).query(
      api.catalog.listProposalsForDefinition.listProposalsForDefinition,
      { puzzleDefinitionId: definitionId },
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "no",
    });
  });
});

describe("catalog.listMyChangeProposals", () => {
  test("requires auth and returns ONLY the caller's proposals across statuses", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const { definitionId, proposalId } = await fileAsBob(t);
    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, brand: "Ravensburger" },
    );

    await expect(
      t.query(api.catalog.listMyChangeProposals.listMyChangeProposals, {}),
    ).rejects.toThrow(/Unauthenticated/);

    const mine = await asBob(t).query(
      api.catalog.listMyChangeProposals.listMyChangeProposals,
      {},
    );
    expect(mine).toHaveLength(2);
    expect(mine.map((p) => p.status).sort()).toEqual(["pending", "withdrawn"]);
    expect(mine.every((p) => p.definitionTitle === "Mountain Vista")).toBe(
      true,
    );

    const alices = await asAlice(t).query(
      api.catalog.listMyChangeProposals.listMyChangeProposals,
      {},
    );
    expect(alices).toHaveLength(0);
  });
});
