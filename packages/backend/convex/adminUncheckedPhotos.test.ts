import { convexTest, type TestConvex } from "convex-test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import { asImage } from "./conversation/messageAttachments";
import { moderationPool } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// Admin manual review of photos the classifier has not decided (pending / unscored):
// listUncheckedPhotos + decideUncheckedPhoto + recheckPhoto. Rows are seeded directly (no
// pipeline run); a re-check is asserted on the job it schedules.

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
    const t = withModerationPool(convexTest(schema, modules));
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
    const t = withModerationPool(convexTest(schema, modules));
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
    // Only an unscored photo offers "Check again"; a pending one is still being checked.
    expect(items.map((i) => i.canRecheck)).toEqual([true, true, false]);
  });
});

describe("decideUncheckedPhoto", () => {
  test("approving a copy photo publishes it, records the admin and stamps the decision", async () => {
    const t = withModerationPool(convexTest(schema, modules));
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
    const t = withModerationPool(convexTest(schema, modules));
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
    const t = withModerationPool(convexTest(schema, modules));
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
    const t = withModerationPool(convexTest(schema, modules));
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
    const t = withModerationPool(convexTest(schema, modules));
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

// The moderation checks enqueued on the moderation pool, as [action, args].
let enqueued: MockInstance<typeof moderationPool.enqueueAction>;
const moderationJobs = () =>
  enqueued.mock.calls.map((call) => [getFunctionName(call[1]), call[2]]);

describe("recheckPhoto", () => {
  // Hold the scheduled check (convex-test would otherwise run it on a timer) so the row is seen
  // as the mutation left it.
  beforeEach(() => {
    vi.useFakeTimers();
    enqueued = vi.spyOn(moderationPool, "enqueueAction");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const recheck = (
    t: TestConvex<typeof schema>,
    source: "copy" | "completion",
    imageId: string,
  ) =>
    asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source,
      imageId,
    });

  test("members cannot check a photo again", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { unscoredCopy } = await seed(t);
    await expect(
      asAlice(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "copy",
        imageId: unscoredCopy,
      }),
    ).rejects.toThrow("Forbidden");
    expect(
      (await t.run((ctx) => ctx.db.get(unscoredCopy)))?.moderationStatus,
    ).toBe("unscored");
    expect(moderationJobs()).toEqual([]);
  });

  test("an unscored copy photo goes back to pending and its upload's moderation action is scheduled", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { unscoredCopy } = await seed(t);
    await recheck(t, "copy", unscoredCopy);
    const row = await t.run((ctx) => ctx.db.get(unscoredCopy));
    expect(row?.moderationStatus).toBe("pending");
    expect(row?.moderationReason).toBeUndefined();
    expect(row?.moderationAttempts).toBeUndefined();
    expect(moderationJobs()).toEqual([
      [
        "library/moderatePhoto:moderatePhoto",
        { imageId: unscoredCopy, pooled: true },
      ],
    ]);
  });

  test("an unscored completion photo goes back to pending and its upload's moderation action is scheduled", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { unscoredCompletion } = await seed(t);
    await recheck(t, "completion", unscoredCompletion);
    const row = await t.run((ctx) => ctx.db.get(unscoredCompletion));
    expect(row?.moderationStatus).toBe("pending");
    expect(row?.moderationReason).toBeUndefined();
    expect(moderationJobs()).toEqual([
      [
        "solving/moderateCompletionPhoto:moderateCompletionPhoto",
        { imageId: unscoredCompletion, pooled: true },
      ],
    ]);
  });

  test("a double click schedules one check; a pending photo is left to the check it is waiting for", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { unscoredCopy, pendingCopy } = await seed(t);
    await Promise.all([
      recheck(t, "copy", unscoredCopy),
      recheck(t, "copy", unscoredCopy),
    ]);
    await recheck(t, "copy", pendingCopy);
    expect(moderationJobs()).toEqual([
      [
        "library/moderatePhoto:moderatePhoto",
        { imageId: unscoredCopy, pooled: true },
      ],
    ]);
    expect(
      (await t.run((ctx) => ctx.db.get(pendingCopy)))?.moderationStatus,
    ).toBe("pending");
  });

  test("a decided, unknown or mismatched photo is refused", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { unscoredCopy, unscoredCompletion } = await seed(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "copy", imageId: unscoredCopy, decision: "approve" },
    );
    await expect(recheck(t, "copy", unscoredCopy)).rejects.toThrow(
      "Only unchecked photos can be checked again",
    );
    await expect(recheck(t, "copy", "not-an-id")).rejects.toThrow(/not found/);
    // A completion photo id passed as a copy photo does not resolve.
    await expect(recheck(t, "copy", unscoredCompletion)).rejects.toThrow(
      /not found/,
    );
    expect(
      (await t.run((ctx) => ctx.db.get(unscoredCopy)))?.moderationStatus,
    ).toBe("approved");
    expect(moderationJobs()).toEqual([]);
  });
});

describe("message photos (spec 2026-10-20 D5)", () => {
  // Alice sent Bob a photo the check could not decide (a message, "unscored"), plus rows that
  // must stay out of the queue: one still pending, one unscored but never sent.
  const seedMessagePhotos = async (t: TestConvex<typeof schema>) => {
    const ids = await seed(t);
    const bob = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_bob"))
          .unique())!._id,
    );
    await t.run((ctx) =>
      ctx.db.insert("follows", {
        followerId: ids.alice,
        followeeId: bob,
        createdAt: 1,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("follows", {
        followerId: bob,
        followeeId: ids.alice,
        createdAt: 1,
      }),
    );
    const threadId = await asAlice(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: bob },
    );
    const photo = (
      status: "unscored" | "pending",
      extra: { sent?: boolean; reencoded?: boolean } = {},
    ) =>
      t.run(async (ctx) =>
        ctx.db.insert("messageAttachments", {
          kind: "image",
          threadAggregateId: threadId,
          uploaderId: ids.alice,
          fileId: await ctx.storage.store(new Blob(["x"])),
          byteSize: 1,
          contentType: "image/jpeg",
          moderationStatus: status,
          moderationReason: status === "unscored" ? "stalled" : undefined,
          blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
          hashCheckedAt: 1,
          ...(extra.reencoded !== false && { reencodedAt: 1 }),
          ...(extra.sent !== false && { messageId: crypto.randomUUID() }),
          createdAt: 4000,
          updatedAt: 4000,
        }),
      );
    const sent = await photo("unscored");
    await photo("pending");
    await photo("unscored", { sent: false });
    return { ...ids, bob, threadId, sent, photo };
  };
  const decide = (
    t: TestConvex<typeof schema>,
    imageId: string,
    decision: "approve" | "reject",
  ) =>
    asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
      source: "message",
      imageId,
      decision,
    });

  test("only a sent, unscored message photo is listed, with no conversation context", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { sent } = await seedMessagePhotos(t);
    const items = (
      await asAdmin(t).query(
        api.admin.listUncheckedPhotos.listUncheckedPhotos,
        {},
      )
    ).filter((item) => item.source === "message");
    expect(items).toEqual([
      {
        key: `message:${sent}`,
        source: "message",
        imageId: sent,
        status: "unscored",
        reason: "stalled",
        attempts: null,
        url: expect.any(String),
        puzzleTitle: "Message photo",
        uploaderName: expect.any(String),
        uploadedAt: 4000,
        canRecheck: true,
      },
    ]);
  });

  test("approve serves it to the recipient; a photo not re-encoded must be checked again first", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { sent, photo, admin } = await seedMessagePhotos(t);
    const raw = await photo("unscored", { reencoded: false });
    await expect(decide(t, raw, "approve")).rejects.toThrow(/re-encoded/);
    expect(
      (
        await asAdmin(t).query(
          api.admin.listUncheckedPhotos.listUncheckedPhotos,
          {},
        )
      ).find((item) => item.imageId === raw)?.url,
    ).toBeNull();

    await decide(t, sent, "approve");
    const row = await t.run(async (ctx) => asImage(await ctx.db.get(sent)));
    expect(row).toMatchObject({
      moderationStatus: "approved",
      moderatedBy: admin,
    });
    expect((await stamps(t)).map((s) => [s.kind, s.targetLabel])).toEqual([
      ["photo_manually_approved", "Message photo"],
    ]);
    await expect(decide(t, sent, "reject")).rejects.toThrow(/already decided/);
  });

  test("reject removes it for both sides and tells the sender a person decided", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { sent, alice } = await seedMessagePhotos(t);
    const fileId = (await t.run(async (ctx) =>
      asImage(await ctx.db.get(sent)),
    ))!.fileId;
    await decide(t, sent, "reject");
    const row = await t.run(async (ctx) => asImage(await ctx.db.get(sent)));
    expect(row?.moderationStatus).toBe("removed");
    expect(await t.run((ctx) => ctx.db.system.get(fileId))).toBeNull();
    const notices = await t.run((ctx) =>
      ctx.db
        .query("notifications")
        .filter((q) => q.eq(q.field("userId"), alice))
        .collect(),
    );
    expect(notices).toEqual([
      expect.objectContaining({
        type: "content_removed",
        params: expect.objectContaining({
          restricted: "photo",
          automated: "false",
        }),
      }),
    ]);
    expect((await stamps(t)).map((s) => s.kind)).toEqual([
      "photo_manually_rejected",
    ]);
  });

  test("members can't decide or re-check a message photo; a pending one is refused", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { sent, photo } = await seedMessagePhotos(t);
    await expect(
      asAlice(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "message",
        imageId: sent,
        decision: "approve",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      asAlice(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "message",
        imageId: sent,
      }),
    ).rejects.toThrow("Forbidden");
    await expect(decide(t, await photo("pending"), "approve")).rejects.toThrow(
      /already decided/,
    );
  });

  test("Check again sends it back through the pipeline", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { sent } = await seedMessagePhotos(t);
    const spy = vi.spyOn(moderationPool, "enqueueAction");
    vi.useFakeTimers();
    try {
      await asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "message",
        imageId: sent,
      });
    } finally {
      vi.useRealTimers();
    }
    const row = await t.run(async (ctx) => asImage(await ctx.db.get(sent)));
    expect(row?.moderationStatus).toBe("pending");
    expect(row?.moderationReason).toBeUndefined();
    expect(spy.mock.calls.map((call) => getFunctionName(call[1]))).toEqual([
      "conversation/moderateMessageImage:moderateMessageImage",
    ]);
  });
});
