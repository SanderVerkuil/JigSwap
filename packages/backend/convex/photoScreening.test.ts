import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
const settleDueJobs = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 200; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy = jobs.some(
      (job) =>
        job.state.kind === "inProgress" ||
        (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
    );
    if (!busy) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);

    const { row, jobs } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("unscored");
    expect(row.moderationReason).toBe("auth");
    expect(jobs.filter((j) => j.state.kind === "pending")).toHaveLength(0);
  });

  test("5xx: stays pending and schedules attempt 2 with backoff", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal("fetch", hfReplies({ status: 503 }));
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);

    const { row, jobs } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("pending");
    const retry = jobs.find(
      (j) => j.state.kind === "pending" && j.name.includes("moderatePhoto"),
    );
    expect(retry?.args[0]).toEqual({ imageId: row._id, attempt: 2 });
    expect(retry!.scheduledTime).toBeGreaterThan(Date.now() + 50_000);
  });

  test("a network error on the last attempt ends unscored (network) with the attempt count", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy);
    expect(row.moderationStatus).toBe("pending");

    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId: row._id,
      attempt: 4,
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
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);

    const { row } = await addPhoto(t, copy);

    expect(row.moderationStatus).toBe("approved");
    expect(row.moderationScore).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("visibility of unscored photos", () => {
  test("the owner sees an unscored copy photo as pending; other members do not see it", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const { row } = await addPhoto(t, copy); // no token => unscored
    expect(row.moderationStatus).toBe("unscored");

    const mine = await galleryOf(t, "alice", copy);
    expect(mine).toHaveLength(1);
    expect(mine![0].moderationStatus).toBe("pending");
    expect(await galleryOf(t, "bob", copy)).toEqual([]);
  });

  test("an unscored cover does not render as the copy's cover", async () => {
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
  });
});
