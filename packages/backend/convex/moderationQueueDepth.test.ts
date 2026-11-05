import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { HASH_RECHECK_POOL_PARALLELISM } from "./lib/imageModeration/hashRecheckPool";
import { MODERATION_POOL_PARALLELISM } from "./lib/imageModeration/moderationPool";
import { QUEUE_DEPTH_SCAN_CAP } from "./lib/imageModeration/queueDepthStore";
import schema from "./schema";

// The moderation queue depth (lib/imageModeration/queueDepthStore + queueDepth, crons.ts): every
// 15 minutes one wide event says how many photos wait on a moderation verdict per table, how long
// the oldest has waited, how many are held for a CSAM hash re-check, and the pools' parallelism,
// so the owner can see whether a burst outruns the pools before raising their limits (PERF-B15).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const capture = (...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
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

type Status = "pending" | "approved" | "rejected" | "unscored" | "quarantined";

type RowFields = {
  status: Status;
  touchedAt: number;
  hashCheck?: {
    pendingHashes?: boolean;
    hashCheckedAt?: number;
    hashCheckTimedOutAt?: number;
  };
};

const PAIR = [{ md5: "m", sha1: "s" }];

// A member, a copy, and inserters for one row of every moderated table.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(new Blob(["x"]));
    return { alice, copy, fileId };
  });

type Seeded = Awaited<ReturnType<typeof seed>>;

const hashFields = (fields: RowFields) => {
  const hash = fields.hashCheck;
  if (hash === undefined) return {};
  return {
    hashCheckPendingSince: fields.touchedAt,
    pendingHashes: hash.pendingHashes ? PAIR : undefined,
    hashCheckedAt: hash.hashCheckedAt,
    hashCheckTimedOutAt: hash.hashCheckTimedOutAt,
  };
};

const insertCopyPhoto = (t: T, s: Seeded, fields: RowFields) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: s.copy,
      uploaderId: s.alice,
      fileId: s.fileId,
      moderationStatus: fields.status,
      createdAt: fields.touchedAt,
      updatedAt: fields.touchedAt,
      ...hashFields(fields),
    }),
  );

const insertCompletionPhoto = (t: T, s: Seeded, fields: RowFields) =>
  t.run((ctx) =>
    ctx.db.insert("completionImages", {
      completionId: crypto.randomUUID(),
      uploaderId: s.alice,
      fileId: s.fileId,
      moderationStatus: fields.status,
      createdAt: fields.touchedAt,
      updatedAt: fields.touchedAt,
      ...hashFields(fields),
    }),
  );

const insertBoxArt = (
  t: T,
  s: Seeded,
  fields: RowFields & { recheckedAt?: number },
) =>
  t.run((ctx) =>
    ctx.db.insert("boxArtUploads", {
      storageId: s.fileId,
      uploaderId: s.alice,
      moderationStatus: fields.status,
      recheckedAt: fields.recheckedAt,
      createdAt: fields.touchedAt,
      ...hashFields(fields),
    }),
  );

const insertMessagePhoto = (t: T, s: Seeded, fields: RowFields) =>
  t.run((ctx) =>
    ctx.db.insert("messageAttachments", {
      kind: "image",
      threadAggregateId: crypto.randomUUID(),
      uploaderId: s.alice,
      fileId: s.fileId,
      byteSize: 1,
      contentType: "image/jpeg",
      moderationStatus: fields.status,
      createdAt: fields.touchedAt,
      updatedAt: fields.touchedAt,
      ...hashFields(fields),
    }),
  );

const insertCircleIcon = (t: T, s: Seeded, fields: RowFields) =>
  t.run((ctx) =>
    ctx.db.insert("circleIcons", {
      circleId: crypto.randomUUID(),
      uploaderId: s.alice,
      fileId: s.fileId,
      moderationStatus: fields.status,
      createdAt: fields.touchedAt,
      updatedAt: fields.touchedAt,
      ...hashFields(fields),
    }),
  );

const readDepth = (t: T) =>
  t.query(
    internal.lib.imageModeration.queueDepthStore.readModerationQueueDepth,
    {},
  );

const byTable = (depths: Awaited<ReturnType<typeof readDepth>>) =>
  Object.fromEntries(depths.map((depth) => [depth.table, depth]));

describe("readModerationQueueDepth", () => {
  test("counts the rows still pending a verdict in every table, decided rows excluded", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const at = Date.now() - 60_000;

    await insertCopyPhoto(t, s, { status: "pending", touchedAt: at });
    await insertCopyPhoto(t, s, { status: "pending", touchedAt: at });
    await insertCopyPhoto(t, s, { status: "approved", touchedAt: at });
    await insertCopyPhoto(t, s, { status: "unscored", touchedAt: at });
    await insertCompletionPhoto(t, s, { status: "pending", touchedAt: at });
    await insertCompletionPhoto(t, s, { status: "rejected", touchedAt: at });
    await insertBoxArt(t, s, { status: "quarantined", touchedAt: at });
    await insertMessagePhoto(t, s, { status: "pending", touchedAt: at });
    await insertMessagePhoto(t, s, { status: "pending", touchedAt: at });
    await insertMessagePhoto(t, s, { status: "pending", touchedAt: at });
    await insertCircleIcon(t, s, { status: "approved", touchedAt: at });

    const depths = byTable(await readDepth(t));
    expect(
      Object.fromEntries(
        Object.entries(depths).map(([table, depth]) => [table, depth.pending]),
      ),
    ).toEqual({ copy: 2, completion: 1, boxArt: 0, message: 3, circleIcon: 0 });
    expect(Object.values(depths).some((depth) => depth.capped)).toBe(false);
    expect(depths.boxArt?.oldestPendingSince).toBeNull();
    expect(depths.circleIcon?.oldestPendingSince).toBeNull();
  });

  test("reports when the longest-waiting pending row was last touched", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.now();

    await insertCopyPhoto(t, s, { status: "pending", touchedAt: now - 5_000 });
    await insertCopyPhoto(t, s, { status: "pending", touchedAt: now - 9_000 });
    await insertCopyPhoto(t, s, {
      status: "approved",
      touchedAt: now - 99_000,
    });
    // Box art counts from an admin's "Check again" when there was one, else from its upload.
    await insertBoxArt(t, s, {
      status: "pending",
      touchedAt: now - 50_000,
      recheckedAt: now - 2_000,
    });
    await insertBoxArt(t, s, { status: "pending", touchedAt: now - 7_000 });

    const depths = byTable(await readDepth(t));
    expect(depths.copy?.oldestPendingSince).toBe(now - 9_000);
    expect(depths.boxArt?.oldestPendingSince).toBe(now - 7_000);
  });

  test("counts the photos held for a hash re-check, not those passed, timed out or quarantined", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const at = Date.now() - 60_000;

    // Waiting: hashes stored, no pass, not timed out.
    await insertCopyPhoto(t, s, {
      status: "approved",
      touchedAt: at,
      hashCheck: { pendingHashes: true },
    });
    await insertMessagePhoto(t, s, {
      status: "approved",
      touchedAt: at,
      hashCheck: { pendingHashes: true },
    });
    // Not waiting: a fresh upload whose first check has not run (no stored hashes yet), one that
    // timed out (an admin decides it), one quarantined, one an admin approved without a check.
    await insertCopyPhoto(t, s, {
      status: "pending",
      touchedAt: at,
      hashCheck: {},
    });
    await insertCopyPhoto(t, s, {
      status: "approved",
      touchedAt: at,
      hashCheck: { pendingHashes: true, hashCheckTimedOutAt: at },
    });
    await insertCompletionPhoto(t, s, {
      status: "quarantined",
      touchedAt: at,
      hashCheck: { pendingHashes: true },
    });
    await insertCircleIcon(t, s, {
      status: "approved",
      touchedAt: at,
      hashCheck: { pendingHashes: true, hashCheckedAt: at },
    });

    const depths = byTable(await readDepth(t));
    expect(
      Object.fromEntries(
        Object.entries(depths).map(([table, depth]) => [
          table,
          depth.hashWaiting,
        ]),
      ),
    ).toEqual({ copy: 1, completion: 0, boxArt: 0, message: 1, circleIcon: 0 });
  });

  test("reads at most the scan cap per table and flags the count as capped", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const at = Date.now() - 60_000;
    await t.run(async (ctx) => {
      for (let i = 0; i < QUEUE_DEPTH_SCAN_CAP + 5; i++) {
        await ctx.db.insert("circleIcons", {
          circleId: crypto.randomUUID(),
          uploaderId: s.alice,
          fileId: s.fileId,
          moderationStatus: "pending",
          createdAt: at,
          updatedAt: at,
        });
      }
    });

    const depths = byTable(await readDepth(t));
    expect(depths.circleIcon?.pending).toBe(QUEUE_DEPTH_SCAN_CAP);
    expect(depths.circleIcon?.capped).toBe(true);
    expect(depths.copy?.capped).toBe(false);
  });
});

describe("logModerationQueueDepth", () => {
  test("logs one wide event with the totals, the oldest wait and both pools' parallelism", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.now();
    await insertCopyPhoto(t, s, { status: "pending", touchedAt: now - 30_000 });
    await insertMessagePhoto(t, s, {
      status: "pending",
      touchedAt: now - 90_000,
    });
    await insertCompletionPhoto(t, s, {
      status: "approved",
      touchedAt: now,
      hashCheck: { pendingHashes: true },
    });

    await t.action(
      internal.lib.imageModeration.queueDepth.logModerationQueueDepth,
      {},
    );

    const events = eventsNamed("imageModeration.queueDepth");
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      outcome: "success",
      pending_total: 2,
      pending_by_table: {
        copy: 1,
        completion: 0,
        boxArt: 0,
        message: 1,
        circleIcon: 0,
      },
      oldest_pending_table: "message",
      hash_waiting_total: 1,
      hash_waiting_by_table: {
        copy: 0,
        completion: 1,
        boxArt: 0,
        message: 0,
        circleIcon: 0,
      },
      capped: false,
      pool_parallelism: MODERATION_POOL_PARALLELISM,
      hash_recheck_parallelism: HASH_RECHECK_POOL_PARALLELISM,
    });
    expect(event?.oldest_pending_age_ms).toBeGreaterThanOrEqual(90_000);
    expect(event?.oldest_pending_age_ms).toBeLessThan(90_000 + 60_000);
  });

  test("an empty queue logs zeros and no oldest wait", async () => {
    const t = convexTest(schema, modules);

    await t.action(
      internal.lib.imageModeration.queueDepth.logModerationQueueDepth,
      {},
    );

    expect(eventsNamed("imageModeration.queueDepth")).toEqual([
      expect.objectContaining({
        pending_total: 0,
        hash_waiting_total: 0,
        oldest_pending_age_ms: null,
        oldest_pending_table: null,
        capped: false,
      }),
    ]);
  });
});
