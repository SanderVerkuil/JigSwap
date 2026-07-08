import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Audit trail: every moderation decision point stamps one `moderationActions` row —
// admin catalog approve/reject (actorId = the acting admin) and the photo pipeline's
// auto-rejections (no actorId = system).

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

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

describe("catalog moderation stamps", () => {
  test("approve stamps one definition_approved row with the acting admin", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitPending(t);

    await asAdmin(t).mutation(
      api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "definition_approved",
      targetLabel: "Mountain Vista",
      targetId: id,
    });
    expect(typeof actions[0].at).toBe("number");
  });

  test("approve with edited: true stamps definition_edited_approved", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitPending(t);

    await asAdmin(t).mutation(
      api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
      { puzzleDefinitionId: id, edited: true },
    );

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("definition_edited_approved");
  });

  test("reject stamps one definition_rejected row", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const id = await submitPending(t);

    await asAdmin(t).mutation(
      api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
      { puzzleDefinitionId: id },
    );

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "definition_rejected",
      targetLabel: "Mountain Vista",
      targetId: id,
    });
  });

  test("a failed transition stamps nothing", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const id = await submitPending(t);
    await asAdmin(t).mutation(
      api.catalog.rejectPuzzleDefinition.rejectPuzzleDefinition,
      { puzzleDefinitionId: id },
    );
    // Approving an already-rejected definition is an illegal transition.
    await expect(
      asAdmin(t).mutation(
        api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
        { puzzleDefinitionId: id },
      ),
    ).rejects.toThrow();
    expect(await allActions(t)).toHaveLength(1); // only the reject stamp
  });
});

describe("photo pipeline stamps", () => {
  // Seed a member + puzzle + copy (with a snapshot title) + a pending photo row, the state the
  // moderatePhoto pipeline operates on before it records a verdict via setModerationVerdict.
  const seedPendingPhoto = async (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "clerk_alice",
        email: "alice@example.com",
        name: "Alice",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        submittedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      const copyId = await ctx.db.insert("ownedPuzzles", {
        puzzleId,
        ownerId: userId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        snapshot: { title: "Starry Night", pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
      });
      const fileId = await ctx.storage.store(new Blob([new Uint8Array(4)]));
      const imageId = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copyId,
        uploaderId: userId,
        fileId,
        moderationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return imageId;
    });

  test("a rejected verdict stamps photo_auto_rejected without an actor", async () => {
    const t = convexTest(schema, modules);
    const imageId = await seedPendingPhoto(t);

    await t.mutation(internal.library.moderationStore.setModerationVerdict, {
      imageId,
      moderationStatus: "rejected",
      moderationScore: 0.97,
      moderationLabel: "nsfw",
    });

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "photo_auto_rejected",
      targetLabel: "Starry Night",
      targetId: imageId,
    });
    expect(actions[0].actorId).toBeUndefined();
  });

  test("an approved verdict stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const imageId = await seedPendingPhoto(t);

    await t.mutation(internal.library.moderationStore.setModerationVerdict, {
      imageId,
      moderationStatus: "approved",
    });

    expect(await allActions(t)).toHaveLength(0);
  });

  test("a rejected→rejected re-run stamps nothing new", async () => {
    const t = convexTest(schema, modules);
    const imageId = await seedPendingPhoto(t);

    await t.mutation(internal.library.moderationStore.setModerationVerdict, {
      imageId,
      moderationStatus: "rejected",
      moderationScore: 0.97,
      moderationLabel: "nsfw",
    });
    // Retry of the pipeline: the row is already rejected, so the guard must skip the stamp.
    await t.mutation(internal.library.moderationStore.setModerationVerdict, {
      imageId,
      moderationStatus: "rejected",
      moderationScore: 0.98,
      moderationLabel: "nsfw",
    });

    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("photo_auto_rejected");
  });
});

// Seed one moderationActions row directly with a controlled timestamp.
const seedAction = (
  t: ReturnType<typeof convexTest>,
  action: {
    kind:
      | "definition_approved"
      | "definition_rejected"
      | "definition_edited_approved"
      | "photo_restored"
      | "photo_removal_confirmed"
      | "photo_auto_rejected"
      | "role_granted"
      | "role_revoked";
    at: number;
    actorId?: Awaited<ReturnType<typeof seedMember>>;
    targetLabel?: string;
    targetId?: string;
  },
) =>
  t.run((ctx) =>
    ctx.db.insert("moderationActions", {
      kind: action.kind,
      targetLabel: action.targetLabel ?? "Some Puzzle",
      targetId: action.targetId ?? "target-1",
      at: action.at,
      ...(action.actorId ? { actorId: action.actorId } : {}),
    }),
  );

describe("getModerationStats", () => {
  test("buckets this week's decisions and excludes rows older than 7 days", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const now = Date.now();
    await seedAction(t, { kind: "definition_approved", at: now - 1000 });
    await seedAction(t, { kind: "definition_edited_approved", at: now - 2000 });
    await seedAction(t, { kind: "definition_rejected", at: now - 3000 });
    await seedAction(t, { kind: "photo_removal_confirmed", at: now - 4000 });
    await seedAction(t, { kind: "photo_auto_rejected", at: now - 5000 });
    // 8 days old: outside the week window, excluded from every count.
    await seedAction(t, {
      kind: "definition_approved",
      at: now - 8 * 24 * 3600 * 1000,
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    expect(stats).toMatchObject({
      approved: 2,
      rejected: 1,
      flagsCleared: 2,
    });
    // The definition rows' targetIds resolve to no puzzle, so avg has no samples.
    expect(stats.avgReviewMins).toBeNull();
  });

  test("avgReviewMins is the rounded mean of decision-time minus submission-time", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    const decidedAt = now - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzles", {
        aggregateId: "agg-a",
        title: "Puzzle A",
        pieceCount: 500,
        status: "approved",
        submittedBy: alice,
        createdAt: decidedAt - 10 * 60_000, // reviewed after 10 minutes
        updatedAt: now,
      });
      await ctx.db.insert("puzzles", {
        aggregateId: "agg-b",
        title: "Puzzle B",
        pieceCount: 500,
        status: "rejected",
        submittedBy: alice,
        createdAt: decidedAt - 21 * 60_000, // reviewed after 21 minutes
        updatedAt: now,
      });
    });
    await seedAction(t, {
      kind: "definition_approved",
      at: decidedAt,
      targetId: "agg-a",
    });
    await seedAction(t, {
      kind: "definition_rejected",
      at: decidedAt,
      targetId: "agg-b",
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    expect(stats.avgReviewMins).toBe(16); // round((10 + 21) / 2) = round(15.5)
  });

  test("avgReviewMins is null when no definition decisions happened this week", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await seedAction(t, {
      kind: "photo_auto_rejected",
      at: Date.now() - 1000,
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    expect(stats.avgReviewMins).toBeNull();
    expect(stats.flagsCleared).toBe(1);
  });
});

describe("getModerationActivity", () => {
  test("returns newest-first with the actor's display name joined in", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    await seedAction(t, {
      kind: "definition_approved",
      at: now - 3000,
      actorId: alice,
      targetLabel: "Older",
      targetId: "t-old",
    });
    await seedAction(t, {
      kind: "photo_auto_rejected",
      at: now - 1000,
      targetLabel: "Newer",
      targetId: "t-new",
    });

    const rows = await asAdmin(t).query(
      api.admin.getModerationActivity.getModerationActivity,
      {},
    );
    expect(rows).toEqual([
      {
        kind: "photo_auto_rejected",
        actorName: null, // system action: no actorId
        targetLabel: "Newer",
        targetId: "t-new",
        at: now - 1000,
      },
      {
        kind: "definition_approved",
        actorName: "Alice",
        targetLabel: "Older",
        targetId: "t-old",
        at: now - 3000,
      },
    ]);
  });

  test("respects limit and defaults to 30", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 35; i++) {
        await ctx.db.insert("moderationActions", {
          kind: "definition_approved",
          targetLabel: `Puzzle ${i}`,
          targetId: `t-${i}`,
          at: now - i * 1000,
        });
      }
    });

    const admin = asAdmin(t);
    expect(
      await admin.query(
        api.admin.getModerationActivity.getModerationActivity,
        {},
      ),
    ).toHaveLength(30);
    const limited = await admin.query(
      api.admin.getModerationActivity.getModerationActivity,
      { limit: 5 },
    );
    expect(limited).toHaveLength(5);
    expect(limited[0].targetLabel).toBe("Puzzle 0"); // newest first
  });
});

describe("moderation read models are admin-gated", () => {
  test("a signed-in non-admin member is Forbidden", async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    await expect(
      asAlice(t).query(api.admin.getModerationStats.getModerationStats, {}),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asAlice(t).query(
        api.admin.getModerationActivity.getModerationActivity,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("an unauthenticated caller is rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.admin.getModerationStats.getModerationStats, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.query(api.admin.getModerationActivity.getModerationActivity, {}),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

describe("role-change kinds in moderation read models", () => {
  test("weekly stats ignore role_granted / role_revoked rows", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    await seedAction(t, { kind: "definition_approved", at: now - 1000 });
    await seedAction(t, {
      kind: "role_granted",
      at: now - 2000,
      actorId: alice,
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    await seedAction(t, {
      kind: "role_revoked",
      at: now - 3000,
      actorId: alice,
      targetLabel: "Cleo",
      targetId: "clerk_cleo",
    });

    const stats = await asAdmin(t).query(
      api.admin.getModerationStats.getModerationStats,
      {},
    );
    // Role rows are audit-only: they must not leak into ANY weekly KPI bucket.
    expect(stats).toMatchObject({ approved: 1, rejected: 0, flagsCleared: 0 });
    expect(stats.avgReviewMins).toBeNull();
  });

  test("the activity feed surfaces role kinds with the actor joined in", async () => {
    const t = convexTest(schema, modules);
    const alice = await seedMember(t);
    const now = Date.now();
    await seedAction(t, {
      kind: "role_granted",
      at: now - 1000,
      actorId: alice,
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    await seedAction(t, {
      kind: "role_revoked",
      at: now - 2000,
      actorId: alice,
      targetLabel: "Cleo",
      targetId: "clerk_cleo",
    });

    const rows = await asAdmin(t).query(
      api.admin.getModerationActivity.getModerationActivity,
      {},
    );
    expect(rows).toEqual([
      {
        kind: "role_granted",
        actorName: "Alice",
        targetLabel: "Bob",
        targetId: "clerk_bob",
        at: now - 1000,
      },
      {
        kind: "role_revoked",
        actorName: "Alice",
        targetLabel: "Cleo",
        targetId: "clerk_cleo",
        at: now - 2000,
      },
    ]);
  });
});
