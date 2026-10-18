import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Admin manual review of photos the classifier has not decided (pending / unscored):
// listUncheckedPhotos + decideUncheckedPhoto. Rows are seeded directly (no pipeline run).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("HF_MODERATION_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const bob = await mkUser("clerk_bob");
    const admin = await mkUser("clerk_admin");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      heldBy: bob, // lets bob view the copy page
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const blob = () =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/jpeg" }),
      );
    const copyPhoto = (
      status: "pending" | "unscored" | "approved",
      at: number,
    ) =>
      blob().then((fileId) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId: alice,
          fileId,
          moderationStatus: status,
          ...(status === "unscored"
            ? { moderationReason: "missing_token", moderationAttempts: 1 }
            : {}),
          createdAt: at,
          updatedAt: at,
        }),
      );
    const unscoredCopy = await copyPhoto("unscored", 1000);
    const pendingCopy = await copyPhoto("pending", 3000);
    await copyPhoto("approved", 500);

    const completionId = crypto.randomUUID();
    const completionFile = await blob();
    await ctx.db.insert("completions", {
      aggregateId: completionId,
      userId: alice,
      startDate: now - 2000,
      endDate: now - 1000,
      photos: [completionFile],
      isCompleted: true,
      copySnapshot: {
        copyId: crypto.randomUUID(),
        ownerId: alice,
        wasBorrowed: false,
        condition: "good",
        title: "Mountain Vista",
        pieceCount: 1000,
      },
      createdAt: now,
      updatedAt: now,
    });
    const unscoredCompletion = await ctx.db.insert("completionImages", {
      completionId,
      uploaderId: alice,
      fileId: completionFile,
      moderationStatus: "unscored",
      moderationReason: "network",
      createdAt: 2000,
      updatedAt: 2000,
    });
    return {
      alice,
      admin,
      copy,
      unscoredCopy,
      pendingCopy,
      completionId,
      completionFile,
      unscoredCompletion,
    };
  });

const stamps = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

describe("admin gating", () => {
  test("members cannot list or decide unchecked photos", async () => {
    const t = convexTest(schema, modules);
    const { unscoredCopy } = await seed(t);
    await expect(
      asAlice(t).query(api.admin.listUncheckedPhotos.listUncheckedPhotos, {}),
    ).rejects.toThrow(ConvexError);
    await expect(
      asAlice(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId: unscoredCopy,
        decision: "approve",
      }),
    ).rejects.toThrow(ConvexError);
    const row = await t.run((ctx) => ctx.db.get(unscoredCopy));
    expect(row?.moderationStatus).toBe("unscored");
    expect(await stamps(t)).toEqual([]);
  });
});

describe("listUncheckedPhotos", () => {
  test("lists pending and unscored copy and completion photos, oldest first", async () => {
    const t = convexTest(schema, modules);
    const { unscoredCopy, pendingCopy, unscoredCompletion } = await seed(t);
    const items = await asAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(items.map((i) => [i.source, i.imageId, i.status, i.reason])).toEqual(
      [
        ["copy", unscoredCopy, "unscored", "missing_token"],
        ["completion", unscoredCompletion, "unscored", "network"],
        ["copy", pendingCopy, "pending", null],
      ],
    );
    expect(items[0].url).toBeTruthy();
    expect(items[0].puzzleTitle).toBe("Mountain Vista");
  });
});

describe("decideUncheckedPhoto", () => {
  test("approving a copy photo publishes it, records the admin and stamps the decision", async () => {
    const t = convexTest(schema, modules);
    const { admin, copy, unscoredCopy } = await seed(t);

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "copy",
        imageId: unscoredCopy,
        decision: "approve",
      },
    );

    const row = await t.run((ctx) => ctx.db.get(unscoredCopy));
    expect(row?.moderationStatus).toBe("approved");
    expect(row?.moderatedBy).toBe(admin);
    expect(row?.moderationReason).toBeUndefined();
    expect(
      (await stamps(t)).map((s) => [s.kind, s.actorId, s.targetLabel]),
    ).toEqual([["photo_manually_approved", admin, "Mountain Vista"]]);

    // Other members now see it.
    const view = await asBob(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.gallery.map((p) => p.id)).toContain(unscoredCopy);
  });

  test("a manual decision is final: a late pipeline verdict is a no-op and the re-screen skips it", async () => {
    const t = convexTest(schema, modules);
    const { pendingCopy } = await seed(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "copy",
        imageId: pendingCopy,
        decision: "approve",
      },
    );
    await t.mutation(internal.library.moderationStore.setModerationVerdict, {
      imageId: pendingCopy,
      moderationStatus: "rejected",
      moderationScore: 0.99,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(pendingCopy)))?.moderationStatus,
    ).toBe("approved");
    const page = await t.query(
      internal.library.moderationStore.listRescreenCandidates,
      { paginationOpts: { numItems: 100, cursor: null } },
    );
    expect(page.candidates.map((c) => c.imageId)).not.toContain(pendingCopy);
  });

  test("rejecting a copy photo moves it to the Flagged Images queue", async () => {
    const t = convexTest(schema, modules);
    const { admin, unscoredCopy } = await seed(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "copy",
        imageId: unscoredCopy,
        decision: "reject",
      },
    );
    const row = await t.run((ctx) => ctx.db.get(unscoredCopy));
    expect(row?.moderationStatus).toBe("rejected");
    const flagged = await asAdmin(t).query(
      api.admin.listRejectedPhotos.listRejectedPhotos,
      {},
    );
    expect(flagged.map((p) => p.imageId)).toEqual([unscoredCopy]);
    expect((await stamps(t)).map((s) => [s.kind, s.actorId])).toEqual([
      ["photo_manually_rejected", admin],
    ]);
  });

  test("rejecting a completion photo detaches it and deletes the blob", async () => {
    const t = convexTest(schema, modules);
    const { completionId, completionFile, unscoredCompletion } = await seed(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "completion",
        imageId: unscoredCompletion,
        decision: "reject",
      },
    );
    const { completion, sidecar, blob } = await t.run(async (ctx) => ({
      completion: await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
      sidecar: await ctx.db.get(unscoredCompletion),
      blob: await ctx.storage.get(completionFile),
    }));
    expect(completion?.photos).toEqual([]);
    expect(sidecar?.moderationStatus).toBe("rejected");
    expect(blob).toBeNull();
    const [stamp] = await stamps(t);
    expect([stamp.kind, stamp.targetId, stamp.targetLabel]).toEqual([
      "photo_manually_rejected",
      completionId,
      "Mountain Vista",
    ]);
  });

  test("an already decided or unknown photo is refused", async () => {
    const t = convexTest(schema, modules);
    const { unscoredCopy } = await seed(t);
    const decide = (imageId: string) =>
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId,
        decision: "reject",
      });
    await decide(unscoredCopy);
    await expect(decide(unscoredCopy)).rejects.toThrow(/already decided/);
    await expect(decide("not-an-id")).rejects.toThrow(/not found/);
    // A completion id passed as a copy photo does not resolve either.
    expect(await stamps(t)).toHaveLength(1);
  });
});
