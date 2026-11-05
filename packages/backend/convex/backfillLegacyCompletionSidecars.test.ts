import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  blobReferenceKinds,
  isReferenced,
} from "./lib/imageModeration/blobReferences";
import { hasMaintenanceMarker } from "./lib/maintenanceMarkers";
import schema from "./schema";
import { BACKFILL_LEGACY_SIDECARS_BATCH } from "./solving/backfillLegacyCompletionSidecars";

// SEC-92: a completion photo stored before the completionImages sidecars existed lives only in
// the unindexable completions.photos array, so blob references (claims, reference-aware deletes,
// the storage sweep) cannot see it. The backfill gives every such photo its sidecar, in the same
// shape the re-screen creates, and counts the completions that cannot have one (no aggregateId).
// A whole real run that leaves no photo without a sidecar records that it is done: the storage
// sweep's delete mode waits for that.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const NOW = 1_700_000_000_000;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const backfill =
  internal.solving.backfillLegacyCompletionSidecars
    .backfillLegacyCompletionSidecars;

type Seeded = {
  alice: Id<"users">;
  legacyA: Id<"_storage">;
  legacyB: Id<"_storage">;
  covered: Id<"_storage">;
  stampless: Id<"_storage">;
};

// One legacy completion with two photos and no sidecars, one whose photo already has its sidecar,
// one without an aggregateId (cannot have a sidecar) and one without photos.
const seed = (t: T): Promise<Seeded> =>
  t.run(async (ctx) => {
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const blob = () =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/jpeg" }),
      ) as Promise<Id<"_storage">>;
    const completion = (
      aggregateId: string | undefined,
      photos: Id<"_storage">[],
    ) =>
      ctx.db.insert("completions", {
        ...(aggregateId && { aggregateId }),
        userId: alice,
        startDate: NOW,
        endDate: NOW,
        photos,
        isCompleted: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const legacyA = await blob();
    const legacyB = await blob();
    const covered = await blob();
    const stampless = await blob();
    await completion("completion-legacy", [legacyA, legacyB]);
    await completion("completion-covered", [covered]);
    await ctx.db.insert("completionImages", {
      completionId: "completion-covered",
      uploaderId: alice,
      fileId: covered,
      moderationStatus: "approved",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await completion(undefined, [stampless]);
    await completion("completion-bare", []);
    return { alice, legacyA, legacyB, covered, stampless };
  });

const sidecars = (t: T) =>
  t.run((ctx) => ctx.db.query("completionImages").collect());

// Run the first batch, drain the self-rescheduled ones, and return the final logged totals.
const runAll = async (t: T, args: { dryRun?: boolean; cursor?: string }) => {
  logs = [];
  vi.useFakeTimers();
  try {
    await t.mutation(backfill, args);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
  const events = logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((e) => e.event === "solving.backfillLegacyCompletionSidecars");
  const last = events[events.length - 1];
  expect(last?.done).toBe(true);
  return last!;
};

const backfilled = (t: T) =>
  t.run((ctx) => hasMaintenanceMarker(ctx, "legacyCompletionSidecars"));

describe("solving/backfillLegacyCompletionSidecars", () => {
  test("defaults to a dry run: counts what it would create and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const before = await sidecars(t);

    const totals = await runAll(t, {});
    expect(totals).toMatchObject({
      dry_run: true,
      completions: 4,
      photos: 4,
      created: 2,
      existing: 1,
      without_aggregate_id: 1,
      photos_without_aggregate_id: 1,
    });
    expect(await sidecars(t)).toEqual(before);
  });

  test("a real run creates the missing sidecars in the re-screen's shape, once", async () => {
    const t = convexTest(schema, modules);
    const { alice, legacyA, legacyB, covered } = await seed(t);

    const first = await runAll(t, { dryRun: false });
    expect(first).toMatchObject({ dry_run: false, created: 2, existing: 1 });

    const rows = await sidecars(t);
    expect(rows).toHaveLength(3);
    for (const fileId of [legacyA, legacyB]) {
      const row = rows.find((r) => r.fileId === fileId)!;
      // No moderation status and no hash-check fields: read exactly like "no sidecar" (a legacy
      // photo, served as before), and still a re-screen candidate.
      const { _id, _creationTime, createdAt, updatedAt, ...shape } = row;
      expect(shape).toEqual({
        completionId: "completion-legacy",
        uploaderId: alice,
        fileId,
      });
      expect(typeof createdAt).toBe("number");
      expect(updatedAt).toBe(createdAt);
      expect(_id && _creationTime).toBeTruthy();
    }
    // The existing sidecar is untouched.
    expect(rows.find((r) => r.fileId === covered)?.moderationStatus).toBe(
      "approved",
    );

    const second = await runAll(t, { dryRun: false });
    expect(second).toMatchObject({ created: 0, existing: 3 });
    expect(await sidecars(t)).toHaveLength(3);
  });

  test("afterwards a legacy photo counts as a blob reference", async () => {
    const t = convexTest(schema, modules);
    const { legacyA, stampless } = await seed(t);
    expect(await t.run((ctx) => isReferenced(ctx, legacyA))).toBe(false);

    await runAll(t, { dryRun: false });
    expect(await t.run((ctx) => isReferenced(ctx, legacyA))).toBe(true);
    expect(
      await t.run(async (ctx) => [...(await blobReferenceKinds(ctx, legacyA))]),
    ).toEqual(["completionPhoto"]);
    // A completion without an aggregateId cannot hold a sidecar: it stays invisible, which is
    // why the run counts it (a storage-sweep precondition).
    expect(await t.run((ctx) => isReferenced(ctx, stampless))).toBe(false);
  });

  test("pages through every completion", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const extra = BACKFILL_LEGACY_SIDECARS_BATCH + 1;
    await t.run(async (ctx) => {
      for (let i = 0; i < extra; i++) {
        const photo = await ctx.storage.store(
          new Blob([`extra ${i}`], { type: "image/jpeg" }),
        );
        await ctx.db.insert("completions", {
          aggregateId: `completion-extra-${i}`,
          userId: alice,
          startDate: NOW,
          photos: [photo],
          isCompleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const totals = await runAll(t, { dryRun: false });
    expect(totals).toMatchObject({
      completions: 4 + extra,
      created: 2 + extra,
    });
    expect(await sidecars(t)).toHaveLength(3 + extra);
  });

  test("only a whole real run that leaves no photo without its sidecar records that it is done", async () => {
    const t = convexTest(schema, modules);
    const { stampless } = await seed(t);

    // A dry run writes nothing, the marker included.
    await runAll(t, {});
    expect(await backfilled(t)).toBe(false);
    // A completion without an aggregateId keeps its photo invisible to blob references.
    await runAll(t, { dryRun: false });
    expect(await backfilled(t)).toBe(false);

    // Once that completion has an aggregateId, the next real run covers its photo and records it.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("completions").collect();
      const row = rows.find((c) => c.photos.includes(stampless))!;
      await ctx.db.patch(row._id, { aggregateId: "completion-stamped" });
    });
    const totals = await runAll(t, { dryRun: false });
    expect(totals).toMatchObject({
      created: 1,
      without_aggregate_id: 0,
      photos_without_aggregate_id: 0,
    });
    expect(await backfilled(t)).toBe(true);
  });

  test("a completion without an aggregateId and without photos does not hold up the marker", async () => {
    const t = convexTest(schema, modules);
    const { stampless } = await seed(t);
    // The stampless completion loses its photo: it can hold no blob, so nothing stays invisible.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("completions").collect();
      const row = rows.find((c) => c.photos.includes(stampless))!;
      await ctx.db.patch(row._id, { photos: [] });
    });

    const totals = await runAll(t, { dryRun: false });
    expect(totals).toMatchObject({
      without_aggregate_id: 1,
      photos_without_aggregate_id: 0,
      marker_recorded: true,
    });
    expect(await backfilled(t)).toBe(true);
  });

  test("a run started part-way through the table does not record it", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("completions").collect()) {
        if (!row.aggregateId) await ctx.db.delete(row._id);
      }
    });
    const { continueCursor } = await t.run((ctx) =>
      ctx.db.query("completions").paginate({ numItems: 1, cursor: null }),
    );

    const totals = await runAll(t, { dryRun: false, cursor: continueCursor });
    expect(totals).toMatchObject({ without_aggregate_id: 0 });
    expect(totals.completions).toBeLessThan(3);
    expect(await backfilled(t)).toBe(false);
  });
});
