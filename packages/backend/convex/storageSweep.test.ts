import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BLOB_HOLDER_KINDS,
  BLOB_HOLDER_SEEDS,
  seedBlobHolderBase,
  storeBlob,
  type BlobHolderBase,
} from "../test-fixtures/blobHolders";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { recordMaintenanceMarker } from "./lib/maintenanceMarkers";
import {
  RECENT_BLOB_WINDOW_MS,
  STORAGE_SWEEP_PAGE,
  UNATTACHED_BOX_ART_TTL_MS,
} from "./lib/storage/storageSweep";
import schema from "./schema";

// SEC-20 / SEC-92: the storage sweep deletes only blobs nothing holds (older than a day),
// and box art that only its listing holds (older than a week, its checks done). It is a dry run
// unless STORAGE_GC_MODE is "delete" and the legacy completion photos have their sidecars;
// otherwise it only reports.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const sweep = internal.lib.storage.storageSweep.sweepStorage;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  vi.stubEnv("AXIOM_API_KEY", "");
  // Unset unless a test turns delete mode on.
  vi.stubEnv("STORAGE_GC_MODE", "");
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type SweepEvent = {
  event: string;
  scope: "all" | "recent";
  mode: "dry_run" | "delete";
  delete_blocked?: string;
  done: boolean;
  batch_candidate_ids: string[];
  scanned: number;
  young: number;
  kept: number;
  kept_by_kind: Record<string, number>;
  candidates: number;
  candidate_bytes: number;
  orphans: number;
  unattached_box_art: number;
  deleted: number;
  deleted_bytes: number;
};

// Run a whole sweep at `at` with STORAGE_GC_MODE set to `envMode` (the first batch, then every
// batch it reschedules), and return its wide events, the last one being the run's totals.
const sweepOnce = async (t: T, at: number, envMode: string) => {
  vi.setSystemTime(at);
  vi.stubEnv("STORAGE_GC_MODE", envMode);
  logs = [];
  await t.mutation(sweep, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const events = logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as SweepEvent)
    .filter((e) => e.event === "storage.sweep");
  const total = events[events.length - 1];
  expect(total?.done).toBe(true);
  return {
    events,
    total: total!,
    candidateIds: events.flatMap((e) => e.batch_candidate_ids),
  };
};

// What solving/backfillLegacyCompletionSidecars records after a clean real run; delete mode
// needs it (see the test below).
const markSidecarsBackfilled = (t: T) =>
  t.run((ctx) => recordMaintenanceMarker(ctx, "legacyCompletionSidecars"));

// A sweep on a deployment whose legacy completion photos are backfilled, in `mode`.
const runSweep = async (
  t: T,
  at: number,
  mode: "dry_run" | "delete" = "dry_run",
) => {
  await markSidecarsBackfilled(t);
  const run = await sweepOnce(t, at, mode === "delete" ? "delete" : "");
  expect(run.events.every((e) => e.mode === mode)).toBe(true);
  return run;
};

const exists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const listingOf = (t: T, id: Id<"_storage">) =>
  t.run((ctx) =>
    ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .first(),
  );

const holdBlob = (
  t: T,
  base: BlobHolderBase,
  kind: (typeof BLOB_HOLDER_KINDS)[number],
  blob: Id<"_storage">,
) => t.run((ctx) => BLOB_HOLDER_SEEDS[kind](ctx, base, blob));

describe("lib/storage/storageSweep", () => {
  // A listing alone is the one holder that expires (below); every other kind keeps its blob for
  // good.
  test.each(BLOB_HOLDER_KINDS.filter((kind) => kind !== "boxArtListing"))(
    "a blob a %s holds is kept, in a dry run and in delete mode",
    async (kind) => {
      const t = convexTest(schema, modules);
      const base = await seedBlobHolderBase(t);
      const blob = await storeBlob(t);
      await holdBlob(t, base, kind, blob);

      const dry = await runSweep(t, T0 + 8 * DAY);
      expect(dry.candidateIds).not.toContain(blob);
      expect(dry.total.kept_by_kind[kind]).toBe(1);

      const real = await runSweep(t, T0 + 8 * DAY, "delete");
      expect(real.candidateIds).not.toContain(blob);
      expect(await exists(t, blob)).toBe(true);
    },
  );

  test("a blob nothing holds is kept for a day, then reported, and deleted only in delete mode", async () => {
    const t = convexTest(schema, modules);
    const orphan = await storeBlob(t);

    // Under a day old: it may be an upload about to be attached.
    const young = await runSweep(t, T0 + 23 * HOUR, "delete");
    expect(young.total).toMatchObject({ scanned: 1, young: 1, candidates: 0 });
    expect(await exists(t, orphan)).toBe(true);

    const dry = await runSweep(t, T0 + 25 * HOUR);
    expect(dry.candidateIds).toEqual([orphan]);
    expect(dry.total).toMatchObject({
      scanned: 1,
      candidates: 1,
      orphans: 1,
      deleted: 0,
    });
    expect(dry.total.candidate_bytes).toBeGreaterThan(0);
    expect(await exists(t, orphan)).toBe(true);

    const real = await runSweep(t, T0 + 25 * HOUR, "delete");
    expect(real.candidateIds).toEqual([orphan]);
    expect(real.total).toMatchObject({ candidates: 1, deleted: 1 });
    expect(real.total.deleted_bytes).toBe(dry.total.candidate_bytes);
    expect(await exists(t, orphan)).toBe(false);
  });

  test("a mode other than exactly 'delete' is a dry run", async () => {
    const t = convexTest(schema, modules);
    const orphan = await storeBlob(t);
    await markSidecarsBackfilled(t);
    const run = await sweepOnce(t, T0 + 2 * DAY, "DELETE");
    expect(run.total).toMatchObject({ mode: "dry_run", deleted: 0 });
    expect(run.total.delete_blocked).toBeUndefined();
    expect(await exists(t, orphan)).toBe(true);
  });

  test("delete mode stays a dry run until the legacy completion photos have their sidecars", async () => {
    const t = convexTest(schema, modules);
    const orphan = await storeBlob(t);

    // Before solving/backfillLegacyCompletionSidecars has run, a completion photo stored before
    // the sidecars existed looks held by nothing: deleting "orphans" could delete it.
    const blocked = await sweepOnce(t, T0 + 2 * DAY, "delete");
    expect(blocked.events.every((e) => e.mode === "dry_run")).toBe(true);
    expect(
      blocked.events.every(
        (e) => e.delete_blocked === "legacy_completion_sidecars_not_backfilled",
      ),
    ).toBe(true);
    expect(blocked.total).toMatchObject({ candidates: 1, deleted: 0 });
    expect(await exists(t, orphan)).toBe(true);

    // The backfill's real run (here: nothing to backfill) records that it is done.
    await t.mutation(
      internal.solving.backfillLegacyCompletionSidecars
        .backfillLegacyCompletionSidecars,
      { dryRun: false },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const real = await sweepOnce(t, T0 + 2 * DAY, "delete");
    expect(real.events.every((e) => e.mode === "delete")).toBe(true);
    expect(real.total.delete_blocked).toBeUndefined();
    expect(real.total).toMatchObject({ candidates: 1, deleted: 1 });
    expect(await exists(t, orphan)).toBe(false);
  });

  test("a preserved blob is never a candidate", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBlobHolderBase(t);
    const preserved = await storeBlob(t);
    await holdBlob(t, base, "preserved", preserved);

    const real = await runSweep(t, T0 + 365 * DAY, "delete");
    expect(real.candidateIds).not.toContain(preserved);
    expect(real.total.kept_by_kind.preserved).toBe(1);
    expect(await exists(t, preserved)).toBe(true);
  });

  test("box art only its listing holds goes after a week, with its listing, only in delete mode", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBlobHolderBase(t);
    const art = await storeBlob(t);
    await holdBlob(t, base, "boxArtListing", art);

    // Within the week the uploader may still submit the form that attaches it.
    const early = await runSweep(t, T0 + 6 * DAY, "delete");
    expect(early.candidateIds).not.toContain(art);
    expect(early.total.kept_by_kind.boxArtListing).toBe(1);
    expect(await exists(t, art)).toBe(true);

    const dry = await runSweep(t, T0 + 8 * DAY);
    expect(dry.candidateIds).toContain(art);
    expect(dry.total.unattached_box_art).toBe(1);
    expect(await exists(t, art)).toBe(true);
    expect(await listingOf(t, art)).not.toBeNull();

    const real = await runSweep(t, T0 + 8 * DAY, "delete");
    expect(real.candidateIds).toContain(art);
    expect(await exists(t, art)).toBe(false);
    // The listing goes with it, so the art can no longer be named in a catalog form.
    expect(await listingOf(t, art)).toBeNull();
  });

  // A rendition never outlives its source (lib/imageModeration/renditionsStore). `_storage` pages
  // in creation order, so a slot blob stored after its source comes up later in the same batch,
  // already deleted, and one stored before it has been counted as kept by then.
  const renditionsOf = (t: T, source: Id<"_storage">) =>
    t.run((ctx) =>
      ctx.db
        .query("imageRenditions")
        .withIndex("by_source", (q) => q.eq("sourceId", source))
        .first(),
    );
  const storeWithRenditions = async (t: T) => {
    const medium = await storeBlob(t); // Backfilled after a re-strip: older than its source.
    const source = await storeBlob(t);
    const small = await storeBlob(t);
    const large = await storeBlob(t);
    await t.run((ctx) =>
      ctx.db.insert("imageRenditions", {
        sourceId: source,
        width: 2000,
        height: 1500,
        small: { fileId: small, width: 480, height: 360 },
        medium: { fileId: medium, width: 640, height: 480 },
        large: { fileId: large, width: 960, height: 720 },
        createdAt: 0,
      }),
    );
    return { source, slots: [small, medium, large] };
  };

  test("box art that goes after a week takes its renditions along, only in delete mode", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBlobHolderBase(t);
    const { source, slots } = await storeWithRenditions(t);
    await holdBlob(t, base, "boxArtListing", source);

    const dry = await runSweep(t, T0 + 8 * DAY);
    expect(dry.total.unattached_box_art).toBe(1);
    expect(dry.total.kept_by_kind.renditionSmall).toBe(1);
    for (const blob of [source, ...slots]) {
      expect(await exists(t, blob)).toBe(true);
    }
    expect(await renditionsOf(t, source)).not.toBeNull();

    const real = await runSweep(t, T0 + 8 * DAY, "delete");
    expect(real.candidateIds).toContain(source);
    // The renditions go with their source: none is a candidate of its own, or counted twice.
    for (const slot of slots) expect(real.candidateIds).not.toContain(slot);
    expect(real.total.deleted).toBe(real.candidateIds.length);
    for (const blob of [source, ...slots]) {
      expect(await exists(t, blob)).toBe(false);
    }
    expect(await renditionsOf(t, source)).toBeNull();
    expect(await listingOf(t, source)).toBeNull();
  });

  test("a blob nothing holds takes its renditions along in delete mode", async () => {
    const t = convexTest(schema, modules);
    await seedBlobHolderBase(t);
    const { source, slots } = await storeWithRenditions(t);

    const real = await runSweep(t, T0 + 2 * DAY, "delete");
    expect(real.candidateIds).toContain(source);
    for (const slot of slots) expect(real.candidateIds).not.toContain(slot);
    for (const blob of [source, ...slots]) {
      expect(await exists(t, blob)).toBe(false);
    }
    expect(await renditionsOf(t, source)).toBeNull();
  });

  test("listed box art a definition or proposal holds is kept, a definition image a proposal recorded too", async () => {
    const t = convexTest(schema, modules);
    const base = await seedBlobHolderBase(t);
    const onDefinition = await storeBlob(t);
    const proposed = await storeBlob(t);
    const baselined = await storeBlob(t);
    await t.run(async (ctx) => {
      for (const blob of [onDefinition, proposed, baselined]) {
        await BLOB_HOLDER_SEEDS.boxArtListing(ctx, base, blob);
      }
      await BLOB_HOLDER_SEEDS.definitionBoxArt(ctx, base, onDefinition);
      await BLOB_HOLDER_SEEDS.proposedBoxArt(ctx, base, proposed);
      // A definition showing `baselined`, and a proposal filed against it that recorded it as
      // the definition's image at the time.
      const definitionId = crypto.randomUUID();
      await ctx.db.insert("puzzles", {
        aggregateId: definitionId,
        title: "Baselined",
        pieceCount: 500,
        image: baselined,
        status: "approved",
        submittedBy: base.member,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("puzzleChangeProposals", {
        aggregateId: crypto.randomUUID(),
        puzzleDefinitionId: definitionId,
        proposedBy: base.member,
        status: "pending",
        changes: { title: "Renamed" },
        baseline: { title: "Baselined", image: baselined },
        createdAt: 0,
        updatedAt: 0,
      });
    });

    const real = await runSweep(t, T0 + 30 * DAY, "delete");
    for (const blob of [onDefinition, proposed, baselined]) {
      expect(real.candidateIds).not.toContain(blob);
      expect(await exists(t, blob)).toBe(true);
      expect(await listingOf(t, blob)).not.toBeNull();
    }
  });

  type ListingFields = Partial<
    Omit<Doc<"boxArtUploads">, "_id" | "_creationTime">
  >;
  test.each<[string, (member: Id<"users">) => ListingFields]>([
    ["still in its content check", () => ({ moderationStatus: "pending" })],
    ["quarantined", () => ({ moderationStatus: "quarantined" })],
    [
      "still waiting for its hash check",
      () => ({ moderationStatus: "unscored", hashCheckPendingSince: T0 }),
    ],
    [
      "approved by an admin without its hash check",
      (member) => ({
        moderationStatus: "approved",
        hashCheckPendingSince: T0,
        hashCheckedAt: T0,
        hashCheckWaivedBy: member,
        pendingHashes: [{ md5: "md5", sha1: "sha1" }],
      }),
    ],
  ])(
    "an unattached listing %s is kept past the week",
    async (_label, fields) => {
      const t = convexTest(schema, modules);
      const base = await seedBlobHolderBase(t);
      const art = await storeBlob(t);
      await t.run(async (ctx) => {
        const listing = (await BLOB_HOLDER_SEEDS.boxArtListing(
          ctx,
          base,
          art,
        )) as Id<"boxArtUploads">;
        await ctx.db.patch(listing, fields(base.member));
      });

      const real = await runSweep(t, T0 + 30 * DAY, "delete");
      expect(real.candidateIds).not.toContain(art);
      expect(await exists(t, art)).toBe(true);
      expect(await listingOf(t, art)).not.toBeNull();
    },
  );

  // The daily run: only blobs recent enough to have just become candidates. A monthly pass over the
  // whole table finds an older blob something has since let go of.
  describe("the recent scope", () => {
    const sweepRecent = async (t: T, at: number) => {
      vi.setSystemTime(at);
      logs = [];
      await t.mutation(sweep, { scope: "recent" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const events = logs
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as SweepEvent)
        .filter((e) => e.event === "storage.sweep");
      return events[events.length - 1]!;
    };

    test("reads no blob older than its window, and leaves it to the whole pass", async () => {
      const t = convexTest(schema, modules);
      const old = await t.run((ctx) => ctx.storage.store(new Blob(["old"])));
      vi.setSystemTime(T0 + RECENT_BLOB_WINDOW_MS);
      const recent = await t.run((ctx) =>
        ctx.storage.store(new Blob(["recent"])),
      );

      const at = T0 + RECENT_BLOB_WINDOW_MS + 2 * DAY;
      const total = await sweepRecent(t, at);
      expect(total).toMatchObject({
        scope: "recent",
        scanned: 1,
        candidates: 1,
      });
      expect(total.batch_candidate_ids).toEqual([recent]);

      const whole = await sweepOnce(t, at, "");
      expect(whole.total).toMatchObject({
        scope: "all",
        scanned: 2,
        candidates: 2,
      });
      expect(whole.candidateIds.sort()).toEqual([old, recent].sort());
    });

    test("is wide enough to see box art turn into a candidate", () => {
      expect(RECENT_BLOB_WINDOW_MS).toBeGreaterThan(UNATTACHED_BOX_ART_TTL_MS);
    });

    test("pages by cursor and keeps its window through the batches", async () => {
      const t = convexTest(schema, modules);
      await t.run(async (ctx) => {
        await ctx.storage.store(new Blob(["old"]));
      });
      vi.setSystemTime(T0 + RECENT_BLOB_WINDOW_MS);
      const count = STORAGE_SWEEP_PAGE + 5;
      await t.run(async (ctx) => {
        for (let i = 0; i < count; i++) {
          await ctx.storage.store(new Blob([`recent ${i}`]));
        }
      });

      const total = await sweepRecent(t, T0 + RECENT_BLOB_WINDOW_MS + 2 * DAY);
      expect(total).toMatchObject({ scanned: count, done: true });
    });

    test("deletes in delete mode like the whole pass does", async () => {
      const t = convexTest(schema, modules);
      vi.stubEnv("STORAGE_GC_MODE", "delete");
      await markSidecarsBackfilled(t);
      const blob = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
      const total = await sweepRecent(t, T0 + 2 * DAY);
      expect(total).toMatchObject({ mode: "delete", deleted: 1 });
      expect(await exists(t, blob)).toBe(false);
    });
  });

  test("pages through every blob, one batch per page", async () => {
    const t = convexTest(schema, modules);
    const count = STORAGE_SWEEP_PAGE * 2 + 5;
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.storage.store(new Blob([`orphan ${i}`]));
      }
    });

    const dry = await runSweep(t, T0 + 2 * DAY);
    expect(dry.events).toHaveLength(3);
    expect(dry.total).toMatchObject({
      scanned: count,
      candidates: count,
      deleted: 0,
    });
    expect(new Set(dry.candidateIds).size).toBe(count);

    const real = await runSweep(t, T0 + 2 * DAY, "delete");
    expect(real.total).toMatchObject({ scanned: count, deleted: count });
    expect(
      await t.run((ctx) => ctx.db.system.query("_storage").collect()),
    ).toEqual([]);
  });
});
