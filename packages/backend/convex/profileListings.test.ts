import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };
const PAGE = { numItems: 20, cursor: null };

// alice: PUBLIC profile with an open copy (carrying every owner-only field) and a closed copy, two
// finished solves (one with an approved and a pending photo) and one in-progress solve.
// carol: PRIVATE profile with a finished solve, an open copy and an in-progress solve.
// bob: mutual follower of alice AND carol. eve: signed in, follows nobody (non-mutual).
// Follow edges are seeded directly (followMember on a private target creates a request).
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const user = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${name.toLowerCase()}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await user("clerk_alice", "Alice");
    const bob = await user("clerk_bob", "Bob");
    const carol = await user("clerk_carol", "Carol");
    await user("clerk_eve", "Eve");

    await ctx.db.insert("profiles", {
      memberId: alice,
      visibility: "public",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: carol,
      visibility: "private",
      updatedAt: now,
    });
    for (const [a, b] of [
      [alice, bob],
      [bob, alice],
      [carol, bob],
      [bob, carol],
    ] as const) {
      await ctx.db.insert("follows", {
        followerId: a,
        followeeId: b,
        createdAt: now,
      });
    }

    const puzzle = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = (
      ownerId: Id<"users">,
      availability: typeof OPEN,
      createdAt: number,
    ) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability,
        notes: "corner piece bent",
        acquisitionDate: now - 1000,
        acquisitionSource: "bought_new",
        acquisitionPrice: { amount: 25, currency: "EUR" },
        createdAt,
        updatedAt: createdAt,
      });
    const aliceOpen = await copy(alice, OPEN, now);
    const aliceClosed = await copy(alice, CLOSED, now - 1);
    const carolOpen = await copy(carol, OPEN, now);

    const approvedPhoto = await ctx.storage.store(
      new Blob(["approved"], { type: "image/png" }),
    );
    const pendingPhoto = await ctx.storage.store(
      new Blob(["pending"], { type: "image/png" }),
    );
    const completion = (
      userId: Id<"users">,
      isCompleted: boolean,
      extra: Partial<{
        aggregateId: string;
        photos: Id<"_storage">[];
        ownedPuzzleId: Id<"ownedPuzzles">;
      }> = {},
    ) =>
      ctx.db.insert("completions", {
        userId,
        puzzleId: puzzle,
        startDate: now - 3 * 3600_000,
        endDate: isCompleted ? now - 3600_000 : undefined,
        completionTimeMinutes: isCompleted ? 120 : undefined,
        notes: "private solve note",
        photos: [],
        isCompleted,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const withPhotos = await completion(alice, true, {
      aggregateId: "cmp-alice-photos",
      photos: [approvedPhoto, pendingPhoto],
      ownedPuzzleId: aliceOpen,
    });
    await ctx.db.insert("completionImages", {
      completionId: "cmp-alice-photos",
      uploaderId: alice,
      fileId: approvedPhoto,
      moderationStatus: "approved",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completionImages", {
      completionId: "cmp-alice-photos",
      uploaderId: alice,
      fileId: pendingPhoto,
      moderationStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await completion(alice, true);
    const aliceInProgress = await completion(alice, false);
    const carolDone = await completion(carol, true);
    const carolInProgress = await completion(carol, false);

    return {
      alice,
      carol,
      aliceOpen,
      aliceClosed,
      carolOpen,
      withPhotos,
      aliceInProgress,
      carolDone,
      carolInProgress,
    };
  });

const as = (t: ReturnType<typeof convexTest>, who: string) =>
  t.withIdentity({ subject: `clerk_${who}` });

const listCopies = (
  t: ReturnType<typeof convexTest>,
  who: string,
  memberId: Id<"users">,
) =>
  as(t, who).query(api.social.listProfileCopies.listProfileCopies, {
    memberId,
    paginationOpts: PAGE,
  });

const listCompletions = (
  t: ReturnType<typeof convexTest>,
  who: string,
  memberId: Id<"users">,
) =>
  as(t, who).query(api.social.listProfileCompletions.listProfileCompletions, {
    memberId,
    paginationOpts: PAGE,
  });

describe("profile listings — copies", () => {
  test("requires an authenticated member", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      t.query(api.social.listProfileCopies.listProfileCopies, {
        memberId: alice,
        paginationOpts: PAGE,
      }),
    ).rejects.toThrow();
  });

  test("a private profile is hidden from a non-mutual viewer", async () => {
    const t = convexTest(schema, modules);
    const { carol } = await seed(t);
    const result = await listCopies(t, "eve", carol);
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  test("a public profile shows open copies but hides non-shared (closed) ones", async () => {
    const t = convexTest(schema, modules);
    const { alice, aliceOpen, aliceClosed } = await seed(t);
    for (const viewer of ["bob", "eve"]) {
      const ids = (await listCopies(t, viewer, alice)).page.map((c) => c._id);
      expect(ids).toEqual([aliceOpen]);
      expect(ids).not.toContain(aliceClosed);
    }
  });

  test("owner-only fields are absent from the returned copy — even for the owner", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    for (const viewer of ["bob", "alice"]) {
      const { page } = await listCopies(t, viewer, alice);
      expect(page.length).toBeGreaterThan(0);
      for (const copy of page) {
        for (const key of [
          "notes",
          "acquisitionDate",
          "acquisitionSource",
          "acquisitionPrice",
        ]) {
          expect(Object.keys(copy)).not.toContain(key);
        }
        expect(JSON.stringify(copy)).not.toContain("corner piece bent");
      }
    }
  });

  test("the owner sees all of their own copies", async () => {
    const t = convexTest(schema, modules);
    const { alice, aliceOpen, aliceClosed } = await seed(t);
    const ids = (await listCopies(t, "alice", alice)).page.map((c) => c._id);
    expect([...ids].sort()).toEqual([aliceOpen, aliceClosed].sort());
  });

  test("a mutual follower of a private member only sees copies canViewCopy allows", async () => {
    // canViewCopy reaches a private owner's copy only via a circle share; an open copy alone is
    // not enough, even for a mutual follower whose profile view is unlocked.
    const t = convexTest(schema, modules);
    const { carol } = await seed(t);
    const result = await listCopies(t, "bob", carol);
    expect(result.page).toEqual([]);
  });
});

describe("profile listings — completions", () => {
  test("a private profile is hidden from a non-mutual viewer", async () => {
    const t = convexTest(schema, modules);
    const { carol } = await seed(t);
    const result = await listCompletions(t, "eve", carol);
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  test("a mutual follower sees a private member's finished solves", async () => {
    const t = convexTest(schema, modules);
    const { carol, carolDone } = await seed(t);
    const ids = (await listCompletions(t, "bob", carol)).page.map((c) => c._id);
    expect(ids).toEqual([carolDone]);
  });

  test("in-progress solves never appear when the share setting is off", async () => {
    const t = convexTest(schema, modules);
    const { alice, carol, aliceInProgress, carolInProgress } = await seed(t);
    // No solvingPreferences row (never chosen) and an explicit false both mean "off".
    await t.run(async (ctx) => {
      await ctx.db.insert("solvingPreferences", {
        memberId: carol,
        shareInProgress: false,
        updatedAt: Date.now(),
      });
    });
    const alicePage = (await listCompletions(t, "bob", alice)).page;
    const carolPage = (await listCompletions(t, "bob", carol)).page;
    expect(alicePage.map((c) => c._id)).not.toContain(aliceInProgress);
    expect(carolPage.map((c) => c._id)).not.toContain(carolInProgress);
  });

  test("rows carry puzzle, date, time and only approved photos — no private notes", async () => {
    const t = convexTest(schema, modules);
    const { alice, withPhotos, aliceOpen } = await seed(t);
    const { page } = await listCompletions(t, "bob", alice);
    expect(page).toHaveLength(2);
    const row = page.find((c) => c._id === withPhotos)!;
    expect(row.title).toBe("Mountain Vista");
    expect(row.pieceCount).toBe(1000);
    expect(row.completionTimeMinutes).toBe(120);
    expect(typeof row.endDate).toBe("number");
    expect(row.photoUrls).toHaveLength(1);
    expect(row.link).toEqual({ kind: "copy", id: aliceOpen });
    for (const c of page) {
      expect(Object.keys(c)).not.toContain("notes");
      expect(JSON.stringify(c)).not.toContain("private solve note");
    }
  });
});
