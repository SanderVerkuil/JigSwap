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
});
