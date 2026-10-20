import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { UNCHECKED_QUEUE_LIMIT } from "./admin/listUncheckedPhotos";
import type {
  CsamHashCheckPort,
  CsamHashCheckResult,
} from "./lib/imageModeration/csamHashCheck";
import {
  HASH_CHECK_TIMEOUT_MS,
  HASH_RECHECK_LOST_AFTER_MS,
  hashRecheckPool,
} from "./lib/imageModeration/hashRecheckPool";
import type { ModerationTable } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// The hash-check TIMEOUT (lib/imageModeration/hashRecheckPool, HASH_CHECK_TIMEOUT_MS): a photo
// that has waited that long on an unavailable hash service stops being re-checked, is stamped
// `hashCheckTimedOutAt`, stays unpublished, and goes to the admin queue (listUncheckedPhotos),
// where an admin approves (without a hash check) or rejects it (decideUncheckedPhoto). A
// re-check that still runs afterwards counts: a match always wins, an admin approval included.
//
// The hash service is a FAKE PORT answering from `hcs.replies`, then `hcs.fallback`.

const hcs = vi.hoisted(() => ({
  replies: [] as CsamHashCheckResult["status"][],
  fallback: "unavailable" as CsamHashCheckResult["status"],
  checks: 0,
}));

vi.mock("./lib/imageModeration/csamHashCheck", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./lib/imageModeration/csamHashCheck")
    >();
  const fakePort: CsamHashCheckPort = {
    provider: "offlimits",
    check: async () => {
      hcs.checks += 1;
      const status = hcs.replies.shift() ?? hcs.fallback;
      return status === "unavailable"
        ? { status, reason: "http_503" }
        : { status };
    },
  };
  return { ...actual, makeCsamHashCheckPortFromEnv: () => fakePort };
});

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  hcs.replies = [];
  hcs.fallback = "unavailable";
  hcs.checks = 0;
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  });
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const eventsNamed = (name: string) =>
  logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === name);

const HASHES = [
  { md5: "a".repeat(32), sha1: "b".repeat(40) },
  { md5: "c".repeat(32), sha1: "d".repeat(40) },
];

const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

type Waiting = {
  /** How long ago the photo started waiting on its hash check. */
  waitedMs: number;
  attempt?: number;
  dueAt?: number;
  moderationStatus?: "approved" | "unscored";
  timedOut?: boolean;
};

// One photo in each table, held unpublished on an unavailable hash check for `waitedMs`.
const seed = (t: T, w: Waiting) =>
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
    const alice = await mkUser(`clerk_alice_${crypto.randomUUID()}`);
    const existingAdmin = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_admin"))
      .unique();
    if (!existingAdmin) await mkUser("clerk_admin");
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
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const blob = () =>
      ctx.storage.store(
        new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
          type: "image/jpeg",
        }),
      );
    const since = now - w.waitedMs;
    const hashFields = {
      hashCheckPendingSince: since,
      pendingHashes: HASHES,
      hashRecheckAttempt: w.attempt,
      hashRecheckDueAt: w.dueAt,
      ...(w.timedOut ? { hashCheckTimedOutAt: now } : {}),
    };
    const status = w.moderationStatus ?? "approved";
    const copyPhoto = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId: await blob(),
      moderationStatus: status,
      reencodedAt: since,
      ...hashFields,
      createdAt: since,
      updatedAt: since,
    });
    const completionPhoto = await ctx.db.insert("completionImages", {
      completionId: crypto.randomUUID(),
      uploaderId: alice,
      fileId: await blob(),
      moderationStatus: status,
      reencodedAt: since,
      ...hashFields,
      createdAt: since,
      updatedAt: since,
    });
    const boxArt = await ctx.db.insert("boxArtUploads", {
      storageId: await blob(),
      uploaderId: alice,
      moderationStatus: status,
      reencodedAt: since,
      ...hashFields,
      createdAt: since,
    });
    const messagePhoto = await ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: crypto.randomUUID(),
      uploaderId: alice,
      fileId: await blob(),
      byteSize: 4,
      contentType: "image/jpeg",
      // Sent: it is a message already, served once a check (or an admin) clears it.
      sendRequestedAt: since,
      sendIndex: 0,
      messageId: crypto.randomUUID(),
      moderationStatus: status,
      reencodedAt: since,
      ...hashFields,
      createdAt: since,
      updatedAt: since,
    });
    return { alice, copyPhoto, completionPhoto, boxArt, messagePhoto };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const rowsOf = (t: T, s: Seeded) =>
  t.run(async (ctx) => ({
    copy: await ctx.db.get(s.copyPhoto),
    completion: await ctx.db.get(s.completionPhoto),
    boxArt: await ctx.db.get(s.boxArt),
    message: await ctx.db
      .get(s.messagePhoto)
      .then((row) => (row?.kind === "image" ? row : null)),
  }));

const continueRecheck = (
  t: T,
  table: ModerationTable,
  imageId: string,
  attempt: number,
) =>
  t.mutation(internal.lib.imageModeration.hashRecheckPool.continueHashRecheck, {
    table,
    imageId,
    attempt,
  });

const pastTimeout = HASH_CHECK_TIMEOUT_MS + 60_000;

// A configured hash service (the port itself is the fake above): a photo approved without a hash
// check is only re-checked against one.
const configureHashService = () => {
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", "https://hcs.example.test");
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "user");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "secret");
};

describe("the timeout", () => {
  test("still unavailable after HASH_CHECK_TIMEOUT_MS: the re-checks stop and every table's photo is timed out, still unpublished", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, attempt: 9 });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    const armed = await Promise.all([
      continueRecheck(t, "copy", s.copyPhoto, 9),
      continueRecheck(t, "completion", s.completionPhoto, 9),
      continueRecheck(t, "boxArt", s.boxArt, 9),
      continueRecheck(t, "message", s.messagePhoto, 9),
    ]);

    expect(armed).toEqual([false, false, false, false]);
    expect(enqueued).not.toHaveBeenCalled();
    for (const row of Object.values(await rowsOf(t, s))) {
      expect(row).toMatchObject({
        hashCheckTimedOutAt: expect.any(Number),
        hashRecheckAttempt: 9,
        pendingHashes: HASHES,
      });
      expect(row?.hashCheckedAt).toBeUndefined();
      expect(row?.hashRecheckDueAt).toBeUndefined();
    }
    expect(
      eventsNamed("imageModeration.hashCheckTimedOut").map((e) => [
        e.table,
        e.outcome,
      ]),
    ).toEqual([
      ["copy", "error"],
      ["completion", "error"],
      ["boxArt", "error"],
      ["message", "error"],
    ]);
    // Nothing more is armed for a timed-out photo.
    expect(await continueRecheck(t, "copy", s.copyPhoto, 9)).toBe(false);
    expect(enqueued).not.toHaveBeenCalled();
  });

  test("a re-check that finds the service still unavailable past the timeout ends the chain", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, attempt: 9 });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId: s.copyPhoto,
      attempt: 9,
      pooled: true,
    });

    expect(hcs.checks).toBe(2);
    expect(enqueued).not.toHaveBeenCalled();
    expect((await rowsOf(t, s)).copy?.hashCheckTimedOutAt).toEqual(
      expect.any(Number),
    );
  });

  test("before the timeout the next re-check is armed as before", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, {
      waitedMs: HASH_CHECK_TIMEOUT_MS - 60 * 60_000,
      attempt: 7,
    });

    expect(await continueRecheck(t, "copy", s.copyPhoto, 7)).toBe(true);

    const { copy } = await rowsOf(t, s);
    expect(copy?.hashRecheckAttempt).toBe(8);
    expect(copy?.hashCheckTimedOutAt).toBeUndefined();
  });

  test("the daily sweep times out a lost row past the timeout instead of re-arming it, then leaves it alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const now = Date.now();
    const s = await seed(t, {
      waitedMs: pastTimeout,
      attempt: 5,
      dueAt: now - HASH_RECHECK_LOST_AFTER_MS - 1,
    });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");
    const sweep = () =>
      t.mutation(
        internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
        { table: "copy", now },
      );

    await sweep();
    await sweep();

    expect(enqueued).not.toHaveBeenCalled();
    expect((await rowsOf(t, s)).copy?.hashCheckTimedOutAt).toEqual(
      expect.any(Number),
    );
    expect(eventsNamed("imageModeration.hashCheckTimedOut")).toHaveLength(1);
    expect(
      eventsNamed("imageModeration.hashRecheckSweep").map((e) => e.waiting),
    ).toEqual([1, 0]);
  });
});

describe("the admin queue", () => {
  test("lists a timed-out photo of every table once, as hashTimedOut, with its image for the admin", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, {
      waitedMs: pastTimeout,
      timedOut: true,
      moderationStatus: "unscored",
    });

    const items = await asAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );

    expect(
      items.map((item) => [item.source, item.imageId, item.status]),
    ).toEqual(
      expect.arrayContaining([
        ["copy", s.copyPhoto, "hashTimedOut"],
        ["completion", s.completionPhoto, "hashTimedOut"],
        ["boxArt", s.boxArt, "hashTimedOut"],
        ["message", s.messagePhoto, "hashTimedOut"],
      ]),
    );
    expect(items).toHaveLength(4);
    expect(items.every((item) => typeof item.url === "string")).toBe(true);
    expect(items.every((item) => !item.canRecheck)).toBe(true);
  });

  test("the hash matches tab counts timed-out photos apart from the waiting ones", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t, { waitedMs: pastTimeout, timedOut: true });
    await seed(t, { waitedMs: 60_000, attempt: 1 });

    const { hashCheck } = await asAdmin(t).query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );

    expect(hashCheck).toMatchObject({ waitingPhotos: 4, timedOutPhotos: 4 });
  });

  test("a photo still waiting (not timed out) cannot be approved yet", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, {
      waitedMs: 60_000,
      attempt: 1,
      moderationStatus: "unscored",
    });

    await expect(
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId: s.copyPhoto,
        decision: "approve",
      }),
    ).rejects.toThrow("has not passed the hash check");
    await expect(
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "message",
        imageId: s.messagePhoto,
        decision: "approve",
      }),
    ).rejects.toThrow("has not passed the hash check");
  });
});

describe("deciding a timed-out photo", () => {
  test("plain approve is refused for a timed-out photo of every table: only the explicit waiver publishes it", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, timedOut: true });
    const admin = asAdmin(t);

    for (const [source, imageId] of [
      ["copy", s.copyPhoto],
      ["completion", s.completionPhoto],
      ["boxArt", s.boxArt],
      ["message", s.messagePhoto],
    ] as const) {
      await expect(
        admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
          source,
          imageId,
          decision: "approve",
        }),
      ).rejects.toThrow("approve it without a hash check instead");
    }
    for (const row of Object.values(await rowsOf(t, s))) {
      expect(row?.hashCheckedAt).toBeUndefined();
      expect(row?.moderatedBy).toBeUndefined();
    }
    expect(
      await t.run((ctx) => ctx.db.query("moderationActions").collect()),
    ).toEqual([]);
  });

  test("the waiver is refused for a photo whose hash check did not time out", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    // Still waiting on its hash check.
    const waiting = await seed(t, {
      waitedMs: 60_000,
      attempt: 1,
      moderationStatus: "unscored",
    });
    const admin = asAdmin(t);
    const waive = (source: ModerationTable, imageId: string) =>
      admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source,
        imageId,
        decision: "waive_hash_check",
      });

    await expect(waive("copy", waiting.copyPhoto)).rejects.toThrow(
      "has not passed the hash check",
    );
    // Hash-cleared and unscored: an ordinary unchecked photo, approved the usual way.
    await t.run(async (ctx) => {
      for (const id of [
        waiting.copyPhoto,
        waiting.completionPhoto,
        waiting.boxArt,
        waiting.messagePhoto,
      ]) {
        await ctx.db.patch(id, {
          hashCheckedAt: Date.now(),
          hashCheckPendingSince: undefined,
          pendingHashes: undefined,
        });
      }
    });
    for (const [source, imageId] of [
      ["copy", waiting.copyPhoto],
      ["completion", waiting.completionPhoto],
      ["boxArt", waiting.boxArt],
      ["message", waiting.messagePhoto],
    ] as const) {
      await expect(waive(source, imageId)).rejects.toThrow(
        "hash check has not timed out",
      );
    }
    expect((await rowsOf(t, waiting)).copy?.moderationStatus).toBe("unscored");
  });

  test("the waiver publishes it without a hash check, records the admin and stamps the waiver", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, timedOut: true });
    const admin = asAdmin(t);
    const decide = (source: ModerationTable, imageId: string) =>
      admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source,
        imageId,
        decision: "waive_hash_check",
      });

    await decide("copy", s.copyPhoto);
    await decide("completion", s.completionPhoto);
    await decide("boxArt", s.boxArt);
    await decide("message", s.messagePhoto);

    const adminId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("users")
          .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_admin"))
          .unique())!._id,
    );
    for (const row of Object.values(await rowsOf(t, s))) {
      expect(row).toMatchObject({
        moderationStatus: "approved",
        moderatedBy: adminId,
        hashCheckedAt: expect.any(Number),
        hashCheckWaivedBy: adminId,
        // Kept: a re-check that still runs can match it.
        pendingHashes: HASHES,
      });
      expect(row?.hashCheckPendingSince).toBeUndefined();
    }
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps.map((s) => s.kind)).toEqual([
      "photo_hash_check_waived",
      "photo_hash_check_waived",
      "photo_hash_check_waived",
      "photo_hash_check_waived",
    ]);
    // Out of the queue, and no longer counted as timed out.
    expect(
      await admin.query(api.admin.listUncheckedPhotos.listUncheckedPhotos, {}),
    ).toEqual([]);
    const { hashCheck } = await admin.query(
      api.admin.listCsamEscalations.listCsamEscalations,
      {},
    );
    expect(hashCheck).toMatchObject({ waitingPhotos: 0, timedOutPhotos: 0 });
  });

  test("reject takes it down like any rejection (a message photo: removed by moderation) and leaves the queue", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, timedOut: true });
    const admin = asAdmin(t);

    await admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
      source: "copy",
      imageId: s.copyPhoto,
      decision: "reject",
    });
    await admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
      source: "message",
      imageId: s.messagePhoto,
      decision: "reject",
    });

    const rows = await rowsOf(t, s);
    expect(rows.copy?.moderationStatus).toBe("rejected");
    expect(rows.copy?.hashCheckedAt).toBeUndefined();
    expect(rows.message?.moderationStatus).toBe("removed");
    expect(rows.message?.hashCheckedAt).toBeUndefined();
    const listed = await admin.query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(listed.map((item) => item.source).sort()).toEqual([
      "boxArt",
      "completion",
    ]);
    // Decided once: a second decision is refused.
    await expect(
      admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId: s.copyPhoto,
        decision: "approve",
      }),
    ).rejects.toThrow("already decided");
  });
});

describe("a re-check after the timeout", () => {
  const recheckCopy = (t: T, imageId: Id<"ownedPuzzleImages">) =>
    t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId,
      attempt: 9,
      pooled: true,
    });

  test("a match wins over an admin approval: the photo is quarantined and escalated", async () => {
    hcs.fallback = "match";
    configureHashService();
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, {
      waitedMs: pastTimeout,
      attempt: 9,
      timedOut: true,
    });
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "copy", imageId: s.copyPhoto, decision: "waive_hash_check" },
    );

    // A job of the row's current attempt that turns up late.
    await recheckCopy(t, s.copyPhoto);

    const { copy } = await rowsOf(t, s);
    expect(copy?.moderationStatus).toBe("quarantined");
    expect(copy?.pendingHashes).toBeUndefined();
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([expect.objectContaining({ table: "ownedPuzzleImages" })]);
    // And the admin can no longer decide it.
    await expect(
      asAdmin(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "copy",
        imageId: s.copyPhoto,
        decision: "reject",
      }),
    ).rejects.toThrow("already decided");
  });

  test("a no_match publishes an undecided timed-out photo, and changes nothing about a rejection", async () => {
    hcs.fallback = "no_match";
    const t = withModerationPool(convexTest(schema, modules));
    const undecided = await seed(t, {
      waitedMs: pastTimeout,
      attempt: 9,
      timedOut: true,
    });
    const rejected = await seed(t, {
      waitedMs: pastTimeout,
      attempt: 9,
      timedOut: true,
    });
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "copy", imageId: rejected.copyPhoto, decision: "reject" },
    );

    await recheckCopy(t, undecided.copyPhoto);
    await recheckCopy(t, rejected.copyPhoto);

    const published = (await rowsOf(t, undecided)).copy;
    expect(published?.hashCheckedAt).toEqual(expect.any(Number));
    expect(published?.moderationStatus).toBe("approved");
    const stillRejected = (await rowsOf(t, rejected)).copy;
    expect(stillRejected?.moderationStatus).toBe("rejected");
    // Out of the timed-out queue either way.
    const listed = await asAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(listed.map((item) => item.imageId)).not.toContain(
      undecided.copyPhoto,
    );
  });
});

describe("a rejected timed-out copy photo in Flagged Images", () => {
  test("is listed with its image for the admin, and restoring it returns it to Unchecked photos, still unpublished", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: pastTimeout, timedOut: true });
    const admin = asAdmin(t);
    await admin.mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
      source: "copy",
      imageId: s.copyPhoto,
      decision: "reject",
    });

    const flagged = await admin.query(
      api.admin.listRejectedPhotos.listRejectedPhotos,
      {},
    );
    expect(flagged).toEqual([
      expect.objectContaining({
        imageId: s.copyPhoto,
        url: expect.any(String),
        hashTimedOut: true,
      }),
    ]);
    // Members never get it: Flagged Images is admin-only.
    await expect(
      t
        .withIdentity({ subject: "clerk_member" })
        .query(api.admin.listRejectedPhotos.listRejectedPhotos, {}),
    ).rejects.toThrow();

    await admin.mutation(api.admin.restorePhoto.restorePhoto, {
      imageId: s.copyPhoto,
    });

    const { copy } = await rowsOf(t, s);
    expect(copy?.moderationStatus).toBe("approved");
    // The gate stays closed: restoring is not a waiver.
    expect(copy?.hashCheckedAt).toBeUndefined();
    expect(copy?.hashCheckWaivedBy).toBeUndefined();
    const listed = await admin.query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(
      listed
        .filter((item) => item.source === "copy")
        .map((item) => [item.imageId, item.status]),
    ).toEqual([[s.copyPhoto, "hashTimedOut"]]);
  });

  test("an ordinary rejected photo is not marked timed out", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: 60_000, attempt: 1 });
    await t.run((ctx) =>
      ctx.db.patch(s.copyPhoto, {
        moderationStatus: "rejected",
        hashCheckedAt: Date.now(),
        hashCheckPendingSince: undefined,
        pendingHashes: undefined,
      }),
    );

    const flagged = await asAdmin(t).query(
      api.admin.listRejectedPhotos.listRejectedPhotos,
      {},
    );
    expect(flagged).toEqual([
      expect.objectContaining({ imageId: s.copyPhoto, hashTimedOut: false }),
    ]);
  });
});

describe("the queue limit", () => {
  // Copy photo rows inserted straight into the table, oldest first.
  const insertCopyPhotos = (
    t: T,
    s: Seeded,
    count: number,
    fields: {
      moderationStatus: "unscored" | "rejected" | "approved";
      timedOut: boolean;
    },
  ) =>
    t.run(async (ctx) => {
      const template = (await ctx.db.get(s.copyPhoto))!;
      const ids: Id<"ownedPuzzleImages">[] = [];
      for (let i = 0; i < count; i++) {
        const now = Date.now();
        ids.push(
          await ctx.db.insert("ownedPuzzleImages", {
            ownedPuzzleId: template.ownedPuzzleId,
            uploaderId: template.uploaderId,
            fileId: template.fileId,
            moderationStatus: fields.moderationStatus,
            reencodedAt: now,
            ...(fields.timedOut
              ? {
                  hashCheckPendingSince: now - pastTimeout,
                  pendingHashes: HASHES,
                  hashCheckTimedOutAt: now,
                }
              : { hashCheckedAt: now }),
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      return ids;
    });

  const copyItems = async (t: T) =>
    (
      await asAdmin(t).query(
        api.admin.listUncheckedPhotos.listUncheckedPhotos,
        {},
      )
    ).filter((item) => item.source === "copy");

  test("more than UNCHECKED_QUEUE_LIMIT rejected timed-out rows do not hide an undecided one", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: 60_000, attempt: 1 });
    await insertCopyPhotos(t, s, UNCHECKED_QUEUE_LIMIT + 5, {
      moderationStatus: "rejected",
      timedOut: true,
    });
    const [undecided] = await insertCopyPhotos(t, s, 1, {
      moderationStatus: "approved",
      timedOut: true,
    });

    expect(
      (await copyItems(t)).map((item) => [item.imageId, item.status]),
    ).toEqual([[undecided, "hashTimedOut"]]);
  });

  test("more than UNCHECKED_QUEUE_LIMIT timed-out unscored rows do not hide an ordinary unscored one", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: 60_000, attempt: 1 });
    await insertCopyPhotos(t, s, UNCHECKED_QUEUE_LIMIT + 5, {
      moderationStatus: "unscored",
      timedOut: true,
    });
    const [ordinary] = await insertCopyPhotos(t, s, 1, {
      moderationStatus: "unscored",
      timedOut: false,
    });

    const items = await copyItems(t);
    expect(items.filter((item) => item.status === "unscored")).toEqual([
      expect.objectContaining({ imageId: ordinary }),
    ]);
    expect(items.filter((item) => item.status === "hashTimedOut")).toHaveLength(
      UNCHECKED_QUEUE_LIMIT,
    );
  });

  test("a timed-out unscored row is listed behind more than UNCHECKED_QUEUE_LIMIT ordinary unscored rows", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t, { waitedMs: 60_000, attempt: 1 });
    await insertCopyPhotos(t, s, UNCHECKED_QUEUE_LIMIT + 5, {
      moderationStatus: "unscored",
      timedOut: false,
    });
    const [timedOutRow] = await insertCopyPhotos(t, s, 1, {
      moderationStatus: "unscored",
      timedOut: true,
    });

    const items = await copyItems(t);
    expect(
      items
        .filter((item) => item.status === "hashTimedOut")
        .map((item) => item.imageId),
    ).toEqual([timedOutRow]);
    expect(items.filter((item) => item.status === "unscored")).toHaveLength(
      UNCHECKED_QUEUE_LIMIT,
    );
  });
});
