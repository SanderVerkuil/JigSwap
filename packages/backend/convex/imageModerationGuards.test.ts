import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_IMAGE_UPLOAD_BYTES } from "./lib/imageModeration/guards";
import schema from "./schema";

// The shared moderation pipeline's input guards, end to end: an upload that is not a supported
// image, is too large, or announces too many pixels is rejected as "invalid_image" before any
// decode or classifier call, and its blob is deleted. WebP passes the guards and keeps the
// pre-existing best-effort path (jimp cannot decode it, so the original bytes are classified).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A clean HF reply; any call to it means the image reached the classifier.
const cleanReply = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify([{ label: "nsfw", score: 0.01 }]), {
        status: 200,
      }),
  );

const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
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
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
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
    return { copy, copyAggregateId };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

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
    if (!busy) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scheduled functions did not settle");
};

const store = (
  t: TestConvex<typeof schema>,
  bytes: Uint8Array | string,
  type: string,
) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type })),
  ) as Promise<Id<"_storage">>;

const blobExists = (t: TestConvex<typeof schema>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const addCopyPhoto = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
  fileId: Id<"_storage">,
) => {
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: copy,
    fileId,
    tag: "box_front",
  });
  await settleDueJobs(t);
  const [row] = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );
  return row;
};

// A 6000 x 5000 (30 MP) PNG header: a few dozen bytes that would decode to a 120 MB bitmap.
const PNG_BOMB = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0x17, 0x70, 0, 0, 0x13, 0x88, 8, 6, 0, 0, 0,
]);

describe("input guards (copy photos)", () => {
  test.each([
    [
      "an SVG",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "image/svg+xml",
      "unsupported_format",
    ],
    [
      "HTML claiming to be a JPEG",
      "<!DOCTYPE html><html></html>",
      "image/jpeg",
      "unsupported_format",
    ],
    ["a decompression bomb", PNG_BOMB, "image/png", "too_many_pixels"],
  ] as const)(
    "%s is rejected as invalid_image, never classified, and its blob deleted",
    async (_name, bytes, type, reason) => {
      const fetchMock = cleanReply();
      vi.stubGlobal("fetch", fetchMock);
      const t = convexTest(schema, modules);
      const { copy } = await seed(t);
      const fileId = await store(t, bytes, type);

      const row = await addCopyPhoto(t, copy, fileId);

      expect(row.moderationStatus).toBe("rejected");
      expect(row.moderationLabel).toBe("invalid_image");
      expect(row.moderationReason).toBe(reason);
      expect(row.moderationScore).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await blobExists(t, fileId)).toBe(false);
    },
  );

  test("more than 10 MB is refused from the storage metadata", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const big = new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    const fileId = await store(t, big, "image/jpeg");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("rejected");
    expect(row.moderationReason).toBe("too_large");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
  });

  test("an admin can still confirm the removal of a refused upload (its blob is already gone)", async () => {
    vi.stubGlobal("fetch", cleanReply());
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const row = await addCopyPhoto(
      t,
      copy,
      await store(t, "<svg></svg>", "image/svg+xml"),
    );
    expect(row.moderationStatus).toBe("rejected");

    await asAdmin(t).mutation(
      api.admin.confirmPhotoRemoval.confirmPhotoRemoval,
      {
        imageId: row._id,
      },
    );

    expect(await t.run((ctx) => ctx.db.get(row._id))).toBeNull();
  });

  test("WebP passes the guards and keeps the best-effort path: classified as uploaded, no re-encode", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    // A lossless 2x2 WebP header (VP8L) with an undecodable body: jimp has no WebP decoder anyway.
    const webp = new Uint8Array([
      ...new TextEncoder().encode("RIFF"),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode("WEBPVP8L"),
      0,
      0,
      0,
      0,
      0x2f,
      0x01,
      0x40,
      0x00,
      0x00,
    ]);
    const fileId = await store(t, webp, "image/webp");

    const row = await addCopyPhoto(t, copy, fileId);

    expect(row.moderationStatus).toBe("approved");
    expect(row.fileId).toBe(fileId);
    expect(row.blurhash).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("input guards (completion photos)", () => {
  test("a refused completion photo is rejected and detached from the completion", async () => {
    const fetchMock = cleanReply();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const { completionId } = await asAlice(t).mutation(
      api.solving.recordCompletion.recordCompletion,
      {
        copyId: copyAggregateId,
        startDate: Date.now() - 7_200_000,
        endDate: Date.now() - 3_600_000,
      },
    );
    const fileId = await store(t, "<html></html>", "image/png");
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
    expect(sidecar.moderationStatus).toBe("rejected");
    expect(sidecar.moderationLabel).toBe("invalid_image");
    expect(sidecar.moderationReason).toBe("unsupported_format");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await blobExists(t, fileId)).toBe(false);
    const completion = await t.run((ctx) =>
      ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique(),
    );
    expect(completion?.photos).toEqual([]);
  });
});
