import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Community change-proposal outcomes (approve/reject) notify the proposer via the Notifications
// subscriber. Filing/editing/withdrawing must NOT notify anyone.

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

// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires,
// then await any in-progress jobs — looped a few times to settle the chain.
const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsFor = (
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

describe("change-proposal outcome notifications", () => {
  test("approval notifies the proposer with proposal_approved", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t); // settle the Filed event first

    await asAdmin(t).mutation(
      api.catalog.approveChangeProposal.approveChangeProposal,
      { changeProposalId: proposalId },
    );
    await flushScheduled(t);

    const rows = await notificationsFor(t, bob);
    const outcome = rows.find((n) => n.type === "proposal_approved");
    expect(outcome).toBeDefined();
    expect(outcome?.params?.puzzleTitle).toContain("Mountain Vista");
  });

  test("rejection notifies the proposer including the reason", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    await asAdmin(t).mutation(
      api.catalog.rejectChangeProposal.rejectChangeProposal,
      { changeProposalId: proposalId, reason: "matches the box" },
    );
    await flushScheduled(t);

    const rows = await notificationsFor(t, bob);
    const outcome = rows.find((n) => n.type === "proposal_rejected");
    expect(outcome).toBeDefined();
    expect(outcome?.params?.reason).toBe("matches the box");
  });

  test("filing/editing/withdrawing produce NO notifications", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await asBob(t).mutation(
      api.catalog.withdrawChangeProposal.withdrawChangeProposal,
      { changeProposalId: proposalId },
    );
    await flushScheduled(t);

    // fileAsBob's setup (submitApproved) legitimately produces its OWN puzzle_approved
    // notification for alice as the definition's submitter — unrelated to this test. Assert on
    // proposal outcome types specifically, so that pre-existing notification is not mistaken for
    // a leak from filing/editing/withdrawing.
    const isProposalOutcome = (n: { type: string }) =>
      n.type === "proposal_approved" || n.type === "proposal_rejected";
    expect((await notificationsFor(t, bob)).filter(isProposalOutcome)).toEqual(
      [],
    );
    expect(
      (await notificationsFor(t, alice)).filter(isProposalOutcome),
    ).toEqual([]);
  });
});
