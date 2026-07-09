import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Admin review notifications: ChangeProposalFiled and PuzzleDefinitionSubmitted fan out to every
// admin (excluding the acting member) so there is an inbox for "things awaiting review". Editing a
// pending proposal must NOT notify (the review queue already reflects edits live).

const seedMembers = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string, role?: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        role,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice", "Alice"),
      bob: await mkUser("clerk_bob", "Bob"),
      // The role mirror must be written explicitly on the seeded row — asAdmin below only
      // impersonates the JWT claim, it never touches this row, and the fan-out reads the mirror
      // via by_role.
      admin: await mkUser("clerk_admin", "Admin", "admin"),
    };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

// Submit (as alice) + approve (as admin), returning an APPROVED definition's aggregateId.
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

describe("admin review notifications", () => {
  test("filing a proposal notifies the admin, not the proposer or another member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, admin } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    const isFiled = (n: { type: string }) => n.type === "admin_proposal_filed";
    const adminNotifications = (await notificationsFor(t, admin)).filter(
      isFiled,
    );
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0]?.message).toContain("Mountain Vista");
    expect(adminNotifications[0]?.relatedId).toBe(proposalId);

    expect((await notificationsFor(t, bob)).filter(isFiled)).toEqual([]);
    expect((await notificationsFor(t, alice)).filter(isFiled)).toEqual([]);
  });

  test("submitting a definition notifies the admin, not the submitter", async () => {
    const t = convexTest(schema, modules);
    const { bob, admin } = await seedMembers(t);
    await asBob(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Desert Ruins", pieceCount: 750 },
    );
    await flushScheduled(t);

    const isSubmitted = (n: { type: string }) =>
      n.type === "admin_definition_submitted";
    const adminNotifications = (await notificationsFor(t, admin)).filter(
      isSubmitted,
    );
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0]?.message).toContain("Desert Ruins");

    expect((await notificationsFor(t, bob)).filter(isSubmitted)).toEqual([]);
  });

  test("actor exclusion: the admin submitting a definition does not self-notify", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    await asAdmin(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Admin's Own Submission", pieceCount: 300 },
    );
    await flushScheduled(t);

    expect(
      (await notificationsFor(t, admin)).filter(
        (n) => n.type === "admin_definition_submitted",
      ),
    ).toEqual([]);
  });

  test("editing a pending proposal produces no admin notification", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    const isFiled = (n: { type: string }) => n.type === "admin_proposal_filed";
    expect((await notificationsFor(t, admin)).filter(isFiled)).toHaveLength(1);

    await asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
      changeProposalId: proposalId,
      title: "Mountain Vista (Wide Panorama)",
    });
    await flushScheduled(t);

    expect((await notificationsFor(t, admin)).filter(isFiled)).toHaveLength(1);
  });
});
