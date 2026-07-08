import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Alice is the acting admin (admin ONLY via the JWT claim — her row mirror is set
// too, to prove the gate never reads it). Bob is the inspected member: three
// copies with availability variety, two collections, one completion, three
// catalog submissions with mixed statuses, one moderation action he PERFORMED
// and one role row TARGETING his clerkId.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });

    const alice = await mkUser("clerk_alice", "Alice", {
      role: "admin",
      username: "alice",
    });
    const bob = await mkUser("clerk_bob", "Bob", {
      username: "bob",
      bio: "Puzzle hoarder",
      location: "Utrecht",
      preferredLanguage: "nl",
    });

    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    // Availability variety: totals must come out as 3 / trade 1 / sale 1 / lend 1.
    const availabilities = [
      { forTrade: true, forSale: false, forLend: false },
      { forTrade: false, forSale: true, forLend: true },
      { forTrade: false, forSale: false, forLend: false },
    ];
    for (const availability of availabilities) {
      await ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId: bob,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const name of ["Favourites", "Gifts"]) {
      await ctx.db.insert("collections", {
        userId: bob,
        name,
        visibility: "private",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("completions", {
      userId: bob,
      puzzleId: puzzle,
      startDate: now - 5000,
      endDate: now,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });

    // Bob's submissions, inserted oldest-first: the read model returns newest first
    // (by_submitted_by + _creationTime descending).
    for (const [title, status] of [
      ["Old Harbour", "rejected"],
      ["Spring Meadow", "pending"],
      ["City Lights", "approved"],
    ] as const) {
      await ctx.db.insert("puzzles", {
        title,
        pieceCount: 500,
        status,
        submittedBy: bob,
        createdAt: now,
        updatedAt: now,
      });
    }

    // One action Bob PERFORMED (he was an admin once), one role row TARGETING him
    // (role rows key targetId on the clerkId).
    await ctx.db.insert("moderationActions", {
      actorId: bob,
      kind: "definition_approved",
      targetLabel: "Mountain Vista",
      targetId: "def-1",
      at: now - 100,
    });
    await ctx.db.insert("moderationActions", {
      actorId: alice,
      kind: "role_granted",
      targetLabel: "Bob",
      targetId: "clerk_bob",
      at: now - 50,
    });

    return { alice, bob };
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

describe("admin/getUserDetail", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expect(
      t.query(api.admin.getUserDetail.getUserDetail, { userId: bob }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a member without the JWT admin claim (even when their ROW mirror says admin)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    // Alice's row carries role "admin" (display mirror) but her identity has no
    // metadata.role claim — the gate must still refuse her.
    await expect(
      asMember(t).query(api.admin.getUserDetail.getUserDetail, {
        userId: bob,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("rejects when the user row does not exist (ConvexError, not a crash)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await t.run((ctx) => ctx.db.delete(bob));
    await expect(
      asAdmin(t).query(api.admin.getUserDetail.getUserDetail, {
        userId: bob,
      }),
    ).rejects.toThrow(/User not found/);
  });

  test("returns the full profile and indexed stats (copies breakdown, collections, solves)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(result.profile).toMatchObject({
      _id: bob,
      clerkId: "clerk_bob",
      name: "Bob",
      username: "bob",
      email: "clerk_bob@example.com",
      bio: "Puzzle hoarder",
      location: "Utrecht",
      preferredLanguage: "nl",
      isActive: true,
    });
    expect(result.profile.role).toBeUndefined();
    expect(typeof result.profile.createdAt).toBe("number");
    expect(typeof result.profile.updatedAt).toBe("number");
    expect(result.stats).toEqual({
      copies: { total: 3, forTrade: 1, forSale: 1, forLend: 1 },
      collections: 2,
      completions: 1,
    });
  });

  test("lists the member's catalog submissions newest first with their statuses", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(result.submissions.map((s) => [s.title, s.status])).toEqual([
      ["City Lights", "approved"],
      ["Spring Meadow", "pending"],
      ["Old Harbour", "rejected"],
    ]);
  });

  test("splits the audit trail into performed (by_actor) and received (by_target on clerkId)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const result = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(result.audit.performed).toEqual([
      {
        kind: "definition_approved",
        actorName: "Bob",
        targetLabel: "Mountain Vista",
        targetId: "def-1",
        at: expect.any(Number),
      },
    ]);
    expect(result.audit.received).toEqual([
      {
        kind: "role_granted",
        actorName: "Alice",
        targetLabel: "Bob",
        targetId: "clerk_bob",
        at: expect.any(Number),
      },
    ]);
  });

  test("caps the audit lists at 20, newest first", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const base = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        await ctx.db.insert("moderationActions", {
          actorId: bob,
          kind: "definition_approved",
          targetLabel: `Puzzle ${i}`,
          targetId: `def-extra-${i}`,
          at: base + i,
        });
      }
    });
    const result = await asAdmin(t).query(
      api.admin.getUserDetail.getUserDetail,
      { userId: bob },
    );
    expect(result.audit.performed).toHaveLength(20);
    expect(result.audit.performed[0].targetLabel).toBe("Puzzle 24");
    expect(result.audit.performed[19].targetLabel).toBe("Puzzle 5");
  });
});
