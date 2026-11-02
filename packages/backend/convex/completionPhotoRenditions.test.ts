import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import {
  allRenditions,
  backfillDoneEvent,
  blobCount,
  blobExists,
  blobType,
  jpeg,
  scheduledRenditions,
  settleRenditions,
  storeBytes,
  storeWebp,
  urlOf,
} from "../test-fixtures/renditionJobs";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { purgeCompletions } from "./conversation/purgeMemberLibrary";
import schema from "./schema";

// Completion-photo renditions (PERF-C1, P-42): a solve's photo is only ever shown as a small tile
// (the viewer opens the original), so once it is approved it gets ONE small WebP, in the generic
// `imageRenditions` table. It lives exactly as long as the photo: deleting the completion, account
// erasure, a rejection and a quarantine all delete it. HCS and the classifier are a routed fake
// `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "offlimits");
  vi.stubEnv("OFFLIMITS_HCS_BASE_URL", HCS_URL);
  vi.stubEnv("OFFLIMITS_HCS_USERNAME", "jigswap");
  vi.stubEnv("OFFLIMITS_HCS_PASSWORD", "s3cret-pass");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type T = TestConvex<typeof schema>;
type SidecarFields = Partial<
  Pick<
    Doc<"completionImages">,
    | "moderationStatus"
    | "moderationScore"
    | "hashCheckedAt"
    | "hashCheckPendingSince"
    | "hashCheckTimedOutAt"
  >
>;

const routedFetch = (hcs: "match" | "no_match" | number, nsfw = 0.01) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === HCS_URL) {
      if (typeof hcs === "number") {
        return new Response("unavailable", { status: hcs });
      }
      return new Response(JSON.stringify({ match: hcs === "match" }), {
        status: 200,
      });
    }
    if (url.includes(HF_HOST)) {
      return new Response(JSON.stringify([{ label: "nsfw", score: nsfw }]), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

// Alice has one finished solve of a copy she owns; Bob is an admin.
const seed = (t: T) =>
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
    await mkUser("clerk_bob");
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
    const copyAggregateId = crypto.randomUUID();
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const completionId: string = crypto.randomUUID();
    await ctx.db.insert("completions", {
      aggregateId: completionId,
      userId: alice,
      startDate: now - 2000,
      endDate: now - 1000,
      photos: [],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, completionId, copyAggregateId };
  });
type Seeded = Awaited<ReturnType<typeof seed>>;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

const completionRow = (t: T, aggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique();
    if (!row) throw new Error("no completion");
    return row;
  });

// A photo of the seeded solve, as the pipeline leaves it: its sidecar and its `photos` entry.
const seedPhoto = async (
  t: T,
  s: Seeded,
  fields: SidecarFields,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
) => {
  const fileId = await storeBytes(t, bytes);
  const imageId = await t.run(async (ctx) => {
    const completion = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", s.completionId))
      .unique();
    await ctx.db.patch(completion!._id, {
      photos: [...completion!.photos, fileId],
    });
    return ctx.db.insert("completionImages", {
      completionId: s.completionId,
      uploaderId: s.alice,
      fileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    });
  });
  return { imageId, fileId };
};

// A rendition of a 1600 x 1200 source, as the generation records it (a stand-in blob).
const seedRendition = async (t: T, sourceId: Id<"_storage">) => {
  const small = await storeWebp(t, `rendition of ${sourceId}`);
  await t.run((ctx) =>
    ctx.db.insert("imageRenditions", {
      sourceId,
      width: 1600,
      height: 1200,
      small: { fileId: small, width: 256, height: 192 },
      createdAt: Date.now(),
    }),
  );
  return small;
};

const generate = internal.lib.imageModeration.renditions.generateRenditions;
const backfill = internal.lib.imageModeration.renditions.backfillRenditions;

describe("completion photo renditions: made once the photo is approved", () => {
  // Attach a 1000 x 750 photo to a solve recorded through the domain and let the pipeline run.
  const attachPhoto = async (t: T, s: Seeded) => {
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: s.copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const upload = await storeBytes(t, await jpeg(1000, 750));
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [upload] },
    );
    await settleDueScheduled(t);
    const [row] = await t.run((ctx) =>
      ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) => q.eq("completionId", completionId))
        .collect(),
    );
    return row;
  };

  test("a clean photo gets one small WebP in the background, from its clean blob", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const row = await attachPhoto(t, s);
    expect(row.moderationStatus).toBe("approved");
    await settleRenditions(t);

    const renditions = await allRenditions(t);
    expect(renditions).toEqual([
      expect.objectContaining({
        sourceId: row.fileId,
        width: 1000,
        height: 750,
        small: expect.objectContaining({ width: 256, height: 192 }),
      }),
    ]);
    expect(renditions[0].medium).toBeUndefined();
    expect(renditions[0].large).toBeUndefined();
    expect(await blobType(t, renditions[0].small!.fileId)).toBe("image/webp");
  });

  test("a photo the classifier rejects gets none", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const row = await attachPhoto(t, s);
    expect(row.moderationStatus).toBe("rejected");
    await settleRenditions(t);

    expect(await allRenditions(t)).toEqual([]);
    expect(await scheduledRenditions(t)).toEqual([]);
  });

  test.each(["pending", "unscored", "rejected", "quarantined"] as const)(
    "a %s photo gets none, and nothing is stored",
    async (moderationStatus) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const photo = await seedPhoto(
        t,
        s,
        { moderationStatus },
        await jpeg(600, 450),
      );
      const before = await blobCount(t);

      expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
        "not_eligible",
      );

      expect(await allRenditions(t)).toEqual([]);
      expect(await blobCount(t)).toBe(before);
    },
  );

  test.each(["approved", "legacy"] as const)(
    "an %s photo gets one small WebP",
    async (status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const photo = await seedPhoto(
        t,
        s,
        status === "legacy" ? {} : { moderationStatus: status },
        await jpeg(600, 450),
      );
      const before = await blobCount(t);

      expect(await t.action(generate, { sourceId: photo.fileId })).toBe(
        "recorded",
      );

      expect(await allRenditions(t)).toEqual([
        expect.objectContaining({
          sourceId: photo.fileId,
          small: expect.objectContaining({ width: 256, height: 192 }),
        }),
      ]);
      expect(await blobCount(t)).toBe(before + 1);
    },
  );

  test("an admin's approval and a waived hash check schedule them", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const unscored = await seedPhoto(t, s, {
      moderationStatus: "unscored",
      hashCheckedAt: 1,
    });
    const timedOut = await seedPhoto(t, s, {
      moderationStatus: "approved",
      moderationScore: 0.01,
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
    });

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "completion", imageId: unscored.imageId, decision: "approve" },
    );
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "completion",
        imageId: timedOut.imageId,
        decision: "waive_hash_check",
      },
    );

    expect(await scheduledRenditions(t)).toEqual([
      unscored.fileId,
      timedOut.fileId,
    ]);
  });

  test("a re-screen approval schedules them; a re-screen rejection deletes them", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const unscored = await seedPhoto(t, s, { moderationStatus: "unscored" });
    // Approved before the classifier ran (no score), with a rendition from the backfill.
    const legacy = await seedPhoto(t, s, {});
    const rendition = await seedRendition(t, legacy.fileId);

    expect(
      await t.mutation(
        internal.solving.completionModerationStore.applyRescreenVerdict,
        {
          imageId: unscored.imageId,
          moderationStatus: "approved",
          moderationScore: 0.01,
        },
      ),
    ).toBe(true);
    expect(await scheduledRenditions(t)).toEqual([unscored.fileId]);

    expect(
      await t.mutation(
        internal.solving.completionModerationStore.applyRescreenVerdict,
        {
          imageId: legacy.imageId,
          moderationStatus: "rejected",
          moderationScore: 0.99,
        },
      ),
    ).toBe(true);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
  });

  test("the metadata strip moves them to the clean blob", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { moderationStatus: "approved" });
    const rendition = await seedRendition(t, photo.fileId);
    const clean = await storeBytes(t, await jpeg(300, 200));

    expect(
      await t.mutation(
        internal.lib.imageModeration.backfillStripMetadataStore.swapBlob,
        {
          table: "completion",
          id: photo.imageId,
          from: photo.fileId,
          to: clean,
        },
      ),
    ).toBe(true);

    expect(
      (await allRenditions(t)).filter((row) => row.sourceId === photo.fileId),
    ).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
    expect(await scheduledRenditions(t)).toEqual([clean]);
  });
});

describe("completion photo renditions: deleted with the photo", () => {
  test("deleting the completion", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: s.copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const photo = await seedPhoto(
      t,
      { ...s, completionId },
      { moderationStatus: "approved" },
    );
    const rendition = await seedRendition(t, photo.fileId);

    await asAlice(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });

    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("account erasure", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { moderationStatus: "approved" });
    const rendition = await seedRendition(t, photo.fileId);

    await t.run((ctx) =>
      purgeCompletions(ctx, s.alice, { cursor: null, numItems: 10 }),
    );

    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("an admin's rejection of an approved photo whose hash check timed out", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      moderationScore: 0.01,
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
    });
    const rendition = await seedRendition(t, photo.fileId);

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "completion", imageId: photo.imageId, decision: "reject" },
    );

    expect(await scheduledRenditions(t)).toEqual([]);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
  });

  test("a hash match deletes them before the row moves to the preserved blob; the escalation is still raised", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { moderationStatus: "approved" });
    const rendition = await seedRendition(t, photo.fileId);
    const preserved = await storeBytes(t, new Uint8Array([9, 9, 9]));

    await t.mutation(
      internal.solving.completionModerationStore.quarantineImage,
      {
        imageId: photo.imageId,
        fileId: preserved,
        uploaderId: s.alice,
        md5: "md5",
        sha1: "sha1",
        provider: "offlimits",
        originalDiscarded: false,
      },
    );

    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, rendition)).toBe(false);
    expect((await completionRow(t, s.completionId)).photos).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([
      expect.objectContaining({
        table: "completionImages",
        rowId: photo.imageId,
        fileId: preserved,
        status: "open",
      }),
    ]);
  });
});

describe("completion photo renditions: served behind the photo's gate, as URLs", () => {
  const myPhotoItems = async (t: T) => {
    const [row] = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    return row.photoItems;
  };

  // Bob, a mutual follower of Alice, on her profile.
  const onProfile = async (t: T, s: Seeded) => {
    await t.run(async (ctx) => {
      const bob = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_bob"))
        .unique();
      for (const [followerId, followeeId] of [
        [s.alice, bob!._id],
        [bob!._id, s.alice],
      ]) {
        await ctx.db.insert("follows", {
          followerId,
          followeeId,
          createdAt: 1,
        });
      }
    });
    const { page } = await t
      .withIdentity({ subject: "clerk_bob" })
      .query(api.social.listProfileCompletions.listProfileCompletions, {
        memberId: s.alice,
        paginationOpts: { numItems: 10, cursor: null },
      });
    return page[0];
  };

  test("an approved photo's tile picks from its rendition; `url`, which the viewer opens, stays the original", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const rendition = await seedRendition(t, photo.fileId);
    const original = await urlOf(t, photo.fileId);

    expect(await myPhotoItems(t)).toEqual([
      {
        url: original,
        pending: false,
        srcSet: `${await urlOf(t, rendition)} 256w, ${original} 1600w`,
      },
    ]);
    const shown = await onProfile(t, s);
    expect(shown.photoUrls).toEqual([original]);
    expect(shown.photoSrcSets).toEqual([
      `${await urlOf(t, rendition)} 256w, ${original} 1600w`,
    ]);
    // URLs only: no storage id on the wire.
    expect(JSON.stringify(shown)).not.toContain(rendition);
    expect(JSON.stringify(shown)).not.toContain(photo.fileId);
  });

  test("before the backfill the photo is served as it was", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    const original = await urlOf(t, photo.fileId);

    expect(await myPhotoItems(t)).toEqual([{ url: original, pending: false }]);
    const shown = await onProfile(t, s);
    expect(shown.photoUrls).toEqual([original]);
    expect(shown.photoSrcSets).toEqual([null]);
  });

  test("a photo still under review shows its uploader the original, and others no rendition", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "pending",
      hashCheckedAt: 1,
    });
    // A leftover row must not open anything: the gate decides, not the rendition.
    const rendition = await seedRendition(t, photo.fileId);

    expect(await myPhotoItems(t)).toEqual([
      { url: await urlOf(t, photo.fileId), pending: true },
    ]);
    const shown = await onProfile(t, s);
    expect(shown.photoUrls).toEqual([]);
    expect(shown.photoSrcSets).toEqual([]);
    expect(JSON.stringify(shown)).not.toContain(await urlOf(t, rendition));
  });

  test("a photo that has not passed its hash check is not served, nor is its rendition", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      hashCheckPendingSince: 1,
    });
    const rendition = await seedRendition(t, photo.fileId);
    const renditionUrl = await urlOf(t, rendition);

    expect(await myPhotoItems(t)).toEqual([]);
    const shown = await onProfile(t, s);
    expect(shown.photoUrls).toEqual([]);
    expect(JSON.stringify(shown)).not.toContain(renditionUrl);
  });

  test("the member's data export keeps the photo's URL and state only", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      hashCheckedAt: 1,
    });
    await seedRendition(t, photo.fileId);

    const { rows } = await asAlice(t).query(
      api.insights.exportUserDataPage.exportUserDataPage,
      { section: "completions", cursor: null },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        photos: [{ url: await urlOf(t, photo.fileId), pending: false }],
      }),
    ]);
  });
});

describe("completion photo renditions: the backfill", () => {
  // Five photos: approved and legacy (both get one), pending and quarantined (none), and one
  // approved photo already recorded.
  const seedPhotos = async (t: T, s: Seeded) => {
    const bytes = await jpeg(600, 450);
    const approved = await seedPhoto(
      t,
      s,
      { moderationStatus: "approved" },
      bytes,
    );
    const legacy = await seedPhoto(t, s, {}, bytes);
    const pending = await seedPhoto(
      t,
      s,
      { moderationStatus: "pending" },
      bytes,
    );
    const quarantined = await seedPhoto(
      t,
      s,
      { moderationStatus: "quarantined" },
      bytes,
    );
    const done = await seedPhoto(t, s, { moderationStatus: "approved" });
    await seedRendition(t, done.fileId);
    return { approved, legacy, pending, quarantined, done };
  };

  test("is a dry run by default: counts the photos that would get one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedPhotos(t, s);
    const before = await blobCount(t);

    expect(await t.action(backfill, { table: "completion" })).toEqual({
      scanned: 5,
      candidates: 2,
      recorded: 0,
      refused: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await blobCount(t)).toBe(before);
  });

  test("a real run covers approved and legacy photos, continues page by page and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const seeded = await seedPhotos(t, s);
    vi.useFakeTimers();

    await t.action(backfill, {
      table: "completion",
      dryRun: false,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const sources = (await allRenditions(t)).map((row) => row.sourceId);
    expect(sources).toEqual(
      expect.arrayContaining([seeded.approved.fileId, seeded.legacy.fileId]),
    );
    expect(sources).toHaveLength(3);
    expect(backfillDoneEvent(logged)).toMatchObject({
      table: "completion",
      dry_run: false,
      scanned: 5,
      candidates: 2,
      recorded: 2,
    });

    vi.useRealTimers();
    expect(
      await t.action(backfill, { table: "completion", dryRun: false }),
    ).toMatchObject({ candidates: 0, recorded: 0 });
  });
});
