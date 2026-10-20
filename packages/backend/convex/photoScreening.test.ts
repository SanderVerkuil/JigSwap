import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// End-to-end tests for the photo-screening pipeline (moderatePhoto / moderateCompletionPhoto),
// the visibility of "unscored" photos, the re-screen backfill and the admin health query. The
// Hugging Face router is replaced by a stubbed global `fetch`; env knobs by vi.stubEnv. The
// scheduled actions run in the background (convex-test drains runAfter via real timers), so each
// test stubs BEFORE uploading and then settles the due jobs.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const ROUTER_URL =
  "https://router.huggingface.co/hf-inference/models/Falconsai/nsfw_image_detection";

// A fake HF response: 200 with the given nsfw score, or a non-OK status.
const hfReplies = (reply: { nsfw: number } | { status: number }) =>
  vi.fn(async () =>
    "status" in reply
      ? new Response(JSON.stringify({ error: "boom" }), {
          status: reply.status,
        })
      : new Response(
          JSON.stringify([
            { label: "nsfw", score: reply.nsfw },
            { label: "normal", score: 1 - reply.nsfw },
          ]),
          { status: 200 },
        ),
  );

beforeEach(() => {
  // Keep the pipeline's own logging out of the test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "");
  vi.stubEnv("SIGHTENGINE_API_USER", "");
  vi.stubEnv("SIGHTENGINE_SECRET_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seed = async (t: TestConvex<typeof schema>) =>
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
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      // Bob holds the copy (a loan), which lets him view its page: the "other member" below.
      heldBy: bob,
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, copy, copyAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

// A real (unique) JPEG so the jimp re-encode step runs for real.
const storeJpeg = async (t: TestConvex<typeof schema>) => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = await image.getBuffer("image/jpeg");
  return (await t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    ),
  )) as Id<"_storage">;
};

// Settle every scheduled job that is DUE (a backoff retry minutes away stays pending).
const settleDueJobs = (t: TestConvex<typeof schema>) => settleDueScheduled(t);

const addPhoto = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
) => {
  const fileId = await storeJpeg(t);
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId,
    tag: "box_front",
  });
  const jobs = await settleDueJobs(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return { row, jobs };
};

const galleryOf = async (
  t: TestConvex<typeof schema>,
  who: "alice" | "bob",
  copy: Id<"ownedPuzzles">,
) =>
  (
    await (who === "alice" ? asAlice(t) : asBob(t)).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    )
  )?.gallery;

describe("moderatePhoto (copy photos)", () => {
  test("a clean score approves the photo with its score; the router is called with a bearer token", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    const fetchMock = hfReplies({ nsfw: 0.01 });
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expect(row.moderationScore).toBe(0.01);
    expect(row.moderationAttempts).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(ROUTER_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer hf_test",
    );
    expect(await galleryOf(t, "bob", copy)).toHaveLength(1);
  });

  test("a high score rejects and stamps the audit trail", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ nsfw: 0.99 }));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("rejected");
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps.map((s) => s.kind)).toEqual(["photo_auto_rejected"]);
  });

  test("no token: unscored (missing_token), never approved, no HTTP call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("unscored");
    expect(row.moderationReason).toBe("missing_token");
    expect(row.moderationScore).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("401: unscored (auth) straight away, no retry scheduled", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_bad");
    vi.stubGlobal("fetch", hfReplies({ status: 401 }));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row, jobs } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("unscored");
    expect(row.moderationReason).toBe("auth");
    expect(jobs.filter((j) => j.state.kind === "pending")).toHaveLength(0);
  });

  test("5xx: stays pending while the pool backs off before attempt 2", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    const fetchMock = hfReplies({ status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("pending");
    expect(row.moderationAttempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("5xx on every attempt: the pool retries it, the last attempt ends unscored (provider_error)", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ status: 503 }));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    vi.useFakeTimers();
    try {
      await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
        copyId: copy,
        fileId: await storeJpeg(t),
        tag: "box_front",
      });
      // Every backoff elapses: attempts 1-3 are retried, attempt 4 records the verdict.
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    const [row] = await t.run((ctx) =>
      ctx.db.query("ownedPuzzleImages").collect(),
    );
    expect(row.moderationStatus).toBe("unscored");
    expect(row.moderationReason).toBe("provider_error");
    // Counted on this test's own row: an earlier test's job waiting on its backoff may wake under
    // the fake clock too (convex-test reuses ids), so the shared fetch stub is not counted.
    expect(row.moderationAttempts).toBe(4);
  });

  test("a network error on the last attempt ends unscored (network) with the attempt count", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy);
    expect(row.moderationStatus).toBe("pending");
    // Three attempts are spent already: this one is the last.
    await t.run((ctx) => ctx.db.patch(row._id, { moderationAttempts: 3 }));

    // The last attempt records the verdict and returns normally: nothing left to retry.
    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId: row._id,
      pooled: true,
    });

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after?.moderationStatus).toBe("unscored");
    expect(after?.moderationReason).toBe("network");
    expect(after?.moderationAttempts).toBe(4);
  });

  test('provider "none" approves without a score (an explicit opt-out)', async () => {
    vi.stubEnv("MODERATION_PROVIDER", "none");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expect(row.moderationScore).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("moderatePhoto with the Sightengine provider", () => {
  const sightengineReplies = (erotica: number) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "success",
            nudity: {
              sexual_activity: 0.001,
              sexual_display: 0.001,
              erotica,
              none: 1 - erotica,
            },
          }),
          { status: 200 },
        ),
    );

  test("a clean result approves with the explicit score; an explicit one rejects", async () => {
    vi.stubEnv("MODERATION_PROVIDER", "sightengine");
    vi.stubEnv("SIGHTENGINE_API_USER", "123");
    vi.stubEnv("SIGHTENGINE_SECRET_KEY", "fake-secret");
    const fetchMock = sightengineReplies(0.02);
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);
    expect(row.moderationStatus).toBe("approved");
    expect(row.moderationScore).toBe(0.02);
    expect(row.moderationLabel).toBe("erotica");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.sightengine.com/1.0/check.json",
    );

    vi.stubGlobal("fetch", sightengineReplies(0.96));
    const t2 = withModerationPool(convexTest(schema, modules));
    const second = await seed(t2);
    expect((await addPhoto(t2, second.copy)).row.moderationStatus).toBe(
      "rejected",
    );
  });

  test("without credentials the photo is unscored and the health check names the missing vars", async () => {
    vi.stubEnv("MODERATION_PROVIDER", "sightengine");
    vi.stubEnv("SIGHTENGINE_SECRET_KEY", "fake-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);
    expect(row.moderationStatus).toBe("unscored");
    expect(row.moderationReason).toBe("missing_token");
    expect(fetchMock).not.toHaveBeenCalled();

    const health = await asAdmin(t).query(
      api.admin.getPhotoScreeningHealth.getPhotoScreeningHealth,
      {},
    );
    expect(health).toMatchObject({
      provider: "sightengine",
      status: "missing_token",
      missingVars: ["SIGHTENGINE_API_USER"],
    });
    expect(JSON.stringify(health)).not.toContain("fake-secret");
  });
});

describe("visibility of unscored photos", () => {
  test("the owner sees an unscored copy photo as pending; other members do not see it", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy); // no token => unscored
    expect(row.moderationStatus).toBe("unscored");

    const mine = await galleryOf(t, "alice", copy);
    expect(mine).toHaveLength(1);
    expect(mine![0].moderationStatus).toBe("pending");
    expect(await galleryOf(t, "bob", copy)).toEqual([]);
  });

  test("other members get a blurhash placeholder only: no URL, storage id or row id", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy); // no token => unscored
    // Computed during the re-encode: a 4x3 blurhash (size flag "L").
    expect(row.blurhash).toMatch(/^L.{27}$/);

    const view = await asBob(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.gallery).toEqual([]);
    expect(view?.pendingPhotos).toEqual([
      { blurhash: row.blurhash, createdAt: row.createdAt },
    ]);
    const url = await t.run((ctx) => ctx.storage.getUrl(row.fileId));
    const json = JSON.stringify(view);
    expect(json).not.toContain(row.fileId);
    expect(json).not.toContain(row._id);
    expect(json).not.toContain(url!);

    // The uploader sees the real photo in the gallery, not a placeholder.
    const mine = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(mine?.pendingPhotos).toEqual([]);
    expect(mine?.gallery[0].url).toBe(url);
  });

  test("a rejected photo leaves no placeholder for anyone", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ nsfw: 0.99 }));
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy);
    expect(row.moderationStatus).toBe("rejected");
    for (const who of [asAlice, asBob]) {
      const view = await who(t).query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: copy },
      );
      expect(view?.gallery).toEqual([]);
      expect(view?.pendingPhotos).toEqual([]);
    }
  });

  test("an unscored cover does not render as the copy's cover", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy);
    await t.run((ctx) => ctx.db.patch(copy, { coverImageId: row._id }));

    const view = await asBob(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.snapshot.coverImageId).toBeNull();
  });

  test("an unscored completion photo is pending for its owner and absent from the profile", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice, copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const fileId = await storeJpeg(t);
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId] },
    );
    await settleDueJobs(t);

    const [sidecar] = await t.run((ctx) =>
      ctx.db
        .query("completionImages")
        .withIndex("by_completion", (q) => q.eq("completionId", completionId))
        .collect(),
    );
    expect(sidecar.moderationStatus).toBe("unscored");
    expect(sidecar.moderationReason).toBe("missing_token");

    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine[0].photoItems).toHaveLength(1);
    expect(mine[0].photoItems[0].pending).toBe(true);

    const profile = await asAlice(t).query(
      api.social.listProfileCompletions.listProfileCompletions,
      { memberId: alice, paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(profile.page).toHaveLength(1);
    expect(profile.page[0].photoUrls).toEqual([]);
    // ...but it shows up as a blurhash placeholder (no URL).
    expect(profile.page[0].pendingPhotos).toEqual([
      { blurhash: sidecar.blurhash },
    ]);
    expect(sidecar.blurhash).toMatch(/^L/);
  });
});

describe("rescreenPhotos", () => {
  // Three copy photos: legacy approved without a score, unscored, and already checked & clean.
  const seedRows = async (t: TestConvex<typeof schema>) => {
    const { alice, copy } = await seed(t);
    const ids = await t.run(async (ctx) => {
      const mk = async (fields: Record<string, unknown>) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId: alice,
          fileId: await ctx.storage.store(
            new Blob([crypto.randomUUID()], { type: "image/jpeg" }),
          ),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...fields,
        } as never);
      return {
        legacy: await mk({}),
        unscored: await mk({
          moderationStatus: "unscored",
          moderationReason: "missing_token",
        }),
        scored: await mk({
          moderationStatus: "approved",
          moderationScore: 0.02,
        }),
      };
    });
    return { copy, ids };
  };

  const rowsOf = (
    t: TestConvex<typeof schema>,
    ids: Record<string, Id<"ownedPuzzleImages">>,
  ) =>
    t.run(async (ctx) => ({
      legacy: await ctx.db.get(ids.legacy),
      unscored: await ctx.db.get(ids.unscored),
      scored: await ctx.db.get(ids.scored),
    }));

  test("a dry run counts candidates and writes nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { ids } = await seedRows(t);
    const before = await rowsOf(t, ids);

    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      {
        table: "copy",
        dryRun: true,
      },
    );

    expect(batch).toMatchObject({ scanned: 3, candidates: 2, approved: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await rowsOf(t, ids)).toEqual(before);
  });

  test("scores the unchecked rows (clean => approved with score, nsfw => rejected) and skips checked ones", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    const scores = [0.01, 0.97];
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ label: "nsfw", score: scores.shift() ?? 0 }]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const { ids } = await seedRows(t);

    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      {
        table: "copy",
        dryRun: false,
        batchSize: 10,
      },
    );

    expect(batch).toMatchObject({ candidates: 2, approved: 1, rejected: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rows = await rowsOf(t, ids);
    expect(rows.legacy?.moderationStatus).toBe("approved");
    expect(rows.legacy?.moderationScore).toBe(0.01);
    expect(rows.unscored?.moderationStatus).toBe("rejected");
    expect(rows.unscored?.moderationReason).toBeUndefined();
    expect(rows.scored?.moderationScore).toBe(0.02);
  });

  test("a provider failure leaves rows untouched (a legacy photo is never hidden by a hiccup)", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ status: 401 }));
    const t = withModerationPool(convexTest(schema, modules));
    const { ids } = await seedRows(t);
    const before = await rowsOf(t, ids);

    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      {
        table: "copy",
        dryRun: false,
      },
    );

    expect(batch.unscored).toBe(1);
    expect(await rowsOf(t, ids)).toEqual(before);
    // Aborted on a configuration error: no follow-up batch scheduled.
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.filter((j) => j.name.includes("rescreenPhotos"))).toEqual([]);
  });

  test("a real run refuses up front without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    await seedRows(t);
    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      {
        table: "copy",
        dryRun: false,
      },
    );
    expect(batch.scanned).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("rescreenPhotos (completion sidecars)", () => {
  test("an unscored completion photo scored nsfw is rejected: detached from the completion and stamped", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const fileId = await storeJpeg(t);
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [fileId] },
    );
    await settleDueJobs(t); // no token => unscored

    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ nsfw: 0.95 }));
    const batch = await t.action(
      internal.library.rescreenPhotos.rescreenPhotos,
      { table: "completion", dryRun: false },
    );

    expect(batch).toMatchObject({ candidates: 1, rejected: 1 });
    const completion = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(completion?.photos).toEqual([]);
    const stamps = await t.run((ctx) =>
      ctx.db.query("moderationActions").collect(),
    );
    expect(stamps.map((s) => s.kind)).toEqual(["photo_auto_rejected"]);
  });
});

describe("getPhotoScreeningHealth", () => {
  test("admin only", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    await expect(
      asAlice(t).query(
        api.admin.getPhotoScreeningHealth.getPhotoScreeningHealth,
        {},
      ),
    ).rejects.toThrow(ConvexError);
  });

  test("reports missing_token and the unscored counts, never the token", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { copy } = await seed(t);
    await addPhoto(t, copy); // no token => unscored
    const health = await asAdmin(t).query(
      api.admin.getPhotoScreeningHealth.getPhotoScreeningHealth,
      {},
    );
    expect(health).toMatchObject({
      status: "missing_token",
      provider: "huggingface",
      tokenConfigured: false,
      unscoredCopyPhotos: 1,
      unscoredCompletionPhotos: 0,
    });

    vi.stubEnv("HF_MODERATION_TOKEN", "hf_secret_value");
    const ok = await asAdmin(t).query(
      api.admin.getPhotoScreeningHealth.getPhotoScreeningHealth,
      {},
    );
    expect(ok.status).toBe("ok");
    expect(JSON.stringify(ok)).not.toContain("hf_secret_value");
  });
});
