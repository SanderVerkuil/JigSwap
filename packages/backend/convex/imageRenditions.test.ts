import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isReferenced } from "./lib/imageModeration/blobReferences";
import { checkImageBytes } from "./lib/imageModeration/guards";
import {
  deleteRenditions,
  scheduleRenditions,
} from "./lib/imageModeration/renditionsStore";
import schema from "./schema";

// Renditions (PERF-C1, P-42): the 480, 640 and 960 px WebP copies of a served image, recorded per
// source blob in `imageRenditions`. Only an image that may be shown gets them (approved box art,
// or legacy box art from before moderation), every rendition blob counts as referenced, they are
// deleted with their source, and the backfill for existing box art is a dry run by default.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const generate = internal.lib.imageModeration.renditions.generateRenditions;
const backfill = internal.lib.imageModeration.renditions.backfillRenditions;
const record = internal.lib.imageModeration.renditionsStore.recordRenditions;

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type T = TestConvex<typeof schema>;
type Status = NonNullable<Doc<"boxArtUploads">["moderationStatus"]>;

// A small photo-like JPEG (a gradient: decodes and encodes quickly).
const jpeg = async (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(
    await Jimp.fromBitmap({ width, height, data }).getBuffer("image/jpeg"),
  );
};

// Grey noise as a JPEG compressed hard: no WebP of it comes out clearly smaller.
const noisyJpeg = async (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4, 255);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data.fill(seed >> 23, i, i + 3);
  }
  return new Uint8Array(
    await Jimp.fromBitmap({ width, height, data }).getBuffer("image/jpeg", {
      quality: 5,
    }),
  );
};

const storeBytes = (t: T, bytes: Uint8Array, type = "image/jpeg") =>
  t.run((ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type })));

const storageCount = (t: T) =>
  t.run(
    async (ctx) => (await ctx.db.system.query("_storage").collect()).length,
  );

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const renditionsOf = (t: T, sourceId: Id<"_storage">) =>
  t.run((ctx) =>
    ctx.db
      .query("imageRenditions")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect(),
  );

// The uploader of all box art (created on first use).
const member = (t: T) =>
  t.run(
    async (ctx) =>
      (await ctx.db.query("users").first())?._id ??
      ctx.db.insert("users", {
        clerkId: "clerk_alice",
        email: "alice@example.com",
        name: "alice",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      }),
  );

// Box art as the catalogue holds it: a definition whose image it is, and its boxArtUploads row
// ("legacy" = a row from before box art was moderated; "none" = no row at all).
const seedBoxArt = async (
  t: T,
  bytes: Uint8Array,
  listing: Status | "legacy" | "none",
  { held = true }: { held?: boolean } = {},
) => {
  const uploaderId = await member(t);
  const storageId = await storeBytes(t, bytes);
  await t.run(async (ctx) => {
    if (listing !== "none") {
      await ctx.db.insert("boxArtUploads", {
        storageId,
        uploaderId,
        ...(listing === "legacy" ? {} : { moderationStatus: listing }),
        createdAt: 1,
      });
    }
    if (held) {
      await ctx.db.insert("puzzles", {
        title: `Puzzle (${listing})`,
        pieceCount: 1000,
        status: "approved",
        submittedBy: uploaderId,
        image: storageId,
        createdAt: 1,
        updatedAt: 1,
      });
    }
  });
  return storageId;
};

const bytesOf = async (t: T, id: Id<"_storage">) => {
  const found = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(id);
    return blob ? { type: blob.type, buffer: await blob.arrayBuffer() } : null;
  });
  return found && { type: found.type, bytes: new Uint8Array(found.buffer) };
};

describe("generateRenditions", () => {
  test("approved box art gets a 480, a 640 and a 960 px WebP, recorded against its blob", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1200, 900), "approved");
    const before = await storageCount(t);

    expect(await t.action(generate, { sourceId })).toBe("recorded");

    const rows = await renditionsOf(t, sourceId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      width: 1200,
      height: 900,
      small: { width: 480, height: 360 },
      medium: { width: 640, height: 480 },
      large: { width: 960, height: 720 },
    });
    expect(await storageCount(t)).toBe(before + 3);
    for (const slot of [row.small!, row.medium!, row.large!]) {
      const stored = await bytesOf(t, slot.fileId);
      expect(stored?.type).toBe("image/webp");
      expect(checkImageBytes(stored!.bytes)).toEqual({
        ok: true,
        format: "webp",
        width: slot.width,
        height: slot.height,
      });
    }
    // One wide event per run, with sizes and no image data.
    const events = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === "imageModeration.renditions");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "success",
      result: "recorded",
      source_width: 1200,
      source_height: 900,
      small_bytes: expect.any(Number),
      medium_bytes: expect.any(Number),
      large_bytes: expect.any(Number),
    });
  });

  test.each(["legacy", "none"] as const)(
    "box art from before moderation (listing: %s) gets renditions",
    async (listing) => {
      const t = convexTest(schema, modules);
      const sourceId = await seedBoxArt(t, await jpeg(1000, 800), listing);

      expect(await t.action(generate, { sourceId })).toBe("recorded");

      expect(await renditionsOf(t, sourceId)).toEqual([
        expect.objectContaining({
          small: expect.objectContaining({ width: 480, height: 384 }),
          medium: expect.objectContaining({ width: 640, height: 512 }),
          large: expect.objectContaining({ width: 960, height: 768 }),
        }),
      ]);
    },
  );

  test.each(["pending", "unscored", "rejected", "quarantined"] as const)(
    "%s box art gets none and stores nothing",
    async (status) => {
      const t = convexTest(schema, modules);
      const sourceId = await seedBoxArt(t, await jpeg(1000, 800), status);
      const before = await storageCount(t);

      expect(await t.action(generate, { sourceId })).toBe("not_eligible");

      expect(await renditionsOf(t, sourceId)).toEqual([]);
      expect(await storageCount(t)).toBe(before);
    },
  );

  test("a blob that is not box art, or is preserved for an escalation, gets none", async () => {
    const t = convexTest(schema, modules);
    const loose = await seedBoxArt(t, await jpeg(1000, 800), "none", {
      held: false,
    });
    const preserved = await seedBoxArt(t, await jpeg(1000, 800), "none");
    await t.run(async (ctx) => {
      await ctx.db.insert("csamEscalations", {
        table: "boxArtUploads",
        rowId: "row",
        uploaderId: (await ctx.db.query("users").first())!._id,
        fileId: preserved,
        md5: "m",
        sha1: "s",
        provider: "test",
        matchedAt: 1,
        status: "open",
      });
    });
    const before = await storageCount(t);

    expect(await t.action(generate, { sourceId: loose })).toBe("not_eligible");
    expect(await t.action(generate, { sourceId: preserved })).toBe(
      "not_eligible",
    );
    expect(await storageCount(t)).toBe(before);
  });

  test("a second run makes nothing new", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1000, 800), "approved");
    await t.action(generate, { sourceId });
    const after = await storageCount(t);

    expect(await t.action(generate, { sourceId })).toBe("already_done");

    expect(await storageCount(t)).toBe(after);
    expect(await renditionsOf(t, sourceId)).toHaveLength(1);
  });

  test("a source with nothing clearly smaller to offer is recorded without renditions, so it is not decoded again", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await noisyJpeg(400, 600), "approved");
    const before = await storageCount(t);

    expect(await t.action(generate, { sourceId })).toBe("recorded");
    const [row] = await renditionsOf(t, sourceId);
    expect(row).toMatchObject({ width: 400, height: 600 });
    expect(row.small).toBeUndefined();
    expect(row.medium).toBeUndefined();
    expect(row.large).toBeUndefined();
    expect(await storageCount(t)).toBe(before);
    expect(
      logged
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.event === "imageModeration.renditions"),
    ).toMatchObject({ result: "recorded", not_smaller: ["small"] });

    expect(await t.action(generate, { sourceId })).toBe("already_done");
  });

  test("a source no wider than 480 px gets one WebP at its own width", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(400, 600), "approved");

    expect(await t.action(generate, { sourceId })).toBe("recorded");

    const [row] = await renditionsOf(t, sourceId);
    expect(row.small).toMatchObject({ width: 400, height: 600 });
    expect(row.medium).toBeUndefined();
    expect(row.large).toBeUndefined();
  });

  test("a 700 px source gets 480 and 640 px renditions and one at its own width", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(700, 500), "approved");

    await t.action(generate, { sourceId });

    const [row] = await renditionsOf(t, sourceId);
    expect(row.small).toMatchObject({ width: 480, height: 343 });
    expect(row.medium).toMatchObject({ width: 640, height: 457 });
    expect(row.large).toMatchObject({ width: 700, height: 500 });
  });

  test("bytes that are not an image finish quietly, storing nothing", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(
      t,
      new Uint8Array([1, 2, 3, 4]),
      "approved",
    );
    const before = await storageCount(t);

    expect(await t.action(generate, { sourceId })).toBe("refused");

    expect(await renditionsOf(t, sourceId)).toEqual([]);
    expect(await storageCount(t)).toBe(before);
  });

  test("a storage failure is retried later, and the retry records the renditions", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1000, 800), "approved");
    vi.useFakeTimers();
    vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    expect(await t.action(generate, { sourceId })).toBe("retry");
    expect(await renditionsOf(t, sourceId)).toEqual([]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await renditionsOf(t, sourceId)).toHaveLength(1);
  });
});

describe("recordRenditions", () => {
  const slotBlobs = async (t: T) => ({
    small: {
      fileId: await storeBytes(t, new Uint8Array([1]), "image/webp"),
      width: 480,
      height: 360,
    },
    medium: {
      fileId: await storeBytes(t, new Uint8Array([2]), "image/webp"),
      width: 640,
      height: 480,
    },
    large: {
      fileId: await storeBytes(t, new Uint8Array([3]), "image/webp"),
      width: 960,
      height: 720,
    },
  });

  test("a source deleted while it was encoded keeps nothing: the new blobs are deleted", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(10, 10), "approved");
    const slots = await slotBlobs(t);
    await t.run((ctx) => ctx.storage.delete(sourceId));

    expect(
      await t.mutation(record, {
        sourceId,
        width: 1200,
        height: 900,
        ...slots,
      }),
    ).toBe(false);

    expect(await renditionsOf(t, sourceId)).toEqual([]);
    expect(await blobExists(t, slots.small.fileId)).toBe(false);
    expect(await blobExists(t, slots.medium.fileId)).toBe(false);
    expect(await blobExists(t, slots.large.fileId)).toBe(false);
  });

  test("a source rejected while it was encoded keeps nothing", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(10, 10), "approved");
    const slots = await slotBlobs(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("boxArtUploads")
        .withIndex("by_storage", (q) => q.eq("storageId", sourceId))
        .unique();
      await ctx.db.patch(row!._id, { moderationStatus: "rejected" });
    });

    expect(
      await t.mutation(record, {
        sourceId,
        width: 1200,
        height: 900,
        ...slots,
      }),
    ).toBe(false);
    expect(await blobExists(t, slots.small.fileId)).toBe(false);
    expect(await blobExists(t, slots.medium.fileId)).toBe(false);
    expect(await blobExists(t, slots.large.fileId)).toBe(false);
  });

  test("a source already recorded keeps its first renditions; the late ones are deleted", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(10, 10), "approved");
    const first = await slotBlobs(t);
    const late = await slotBlobs(t);
    expect(
      await t.mutation(record, {
        sourceId,
        width: 1200,
        height: 900,
        ...first,
      }),
    ).toBe(true);

    expect(
      await t.mutation(record, { sourceId, width: 1200, height: 900, ...late }),
    ).toBe(false);

    const [row] = await renditionsOf(t, sourceId);
    expect(row.small?.fileId).toBe(first.small.fileId);
    expect(row.large?.fileId).toBe(first.large.fileId);
    expect(await blobExists(t, first.small.fileId)).toBe(true);
    expect(await blobExists(t, first.large.fileId)).toBe(true);
    expect(await blobExists(t, late.small.fileId)).toBe(false);
    expect(await blobExists(t, late.medium.fileId)).toBe(false);
    expect(await blobExists(t, late.large.fileId)).toBe(false);
  });
});

describe("references and deletion", () => {
  test("every rendition blob counts as referenced", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1000, 800), "approved");
    await t.action(generate, { sourceId });
    const [row] = await renditionsOf(t, sourceId);
    const loose = await storeBytes(t, new Uint8Array([9]));

    expect(
      await t.run(async (ctx) => [
        await isReferenced(ctx, row.small!.fileId),
        await isReferenced(ctx, row.medium!.fileId),
        await isReferenced(ctx, row.large!.fileId),
        await isReferenced(ctx, loose),
      ]),
    ).toEqual([true, true, true, false]);
  });

  test("deleteRenditions removes the row and its blobs, also when a blob is already gone", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1000, 800), "approved");
    await t.action(generate, { sourceId });
    const [row] = await renditionsOf(t, sourceId);
    await t.run((ctx) => ctx.storage.delete(row.small!.fileId));

    await t.run((ctx) => deleteRenditions(ctx, sourceId));

    expect(await renditionsOf(t, sourceId)).toEqual([]);
    expect(await blobExists(t, row.medium!.fileId)).toBe(false);
    expect(await blobExists(t, row.large!.fileId)).toBe(false);
    // The source itself is its owner's to delete.
    expect(await blobExists(t, sourceId)).toBe(true);
    // Nothing to delete is fine too.
    await t.run((ctx) => deleteRenditions(ctx, sourceId));
  });

  test("scheduleRenditions makes them in the background", async () => {
    const t = convexTest(schema, modules);
    const sourceId = await seedBoxArt(t, await jpeg(1000, 800), "approved");
    vi.useFakeTimers();

    await t.run((ctx) => scheduleRenditions(ctx, sourceId));
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await renditionsOf(t, sourceId)).toHaveLength(1);
  });
});

describe("backfillRenditions", () => {
  // Six definitions: legacy box art without a listing; approved, pending and rejected box art;
  // approved box art already recorded (too small for any rendition); and one without an image.
  const seedCatalogue = async (t: T) => {
    const image = await jpeg(1000, 800);
    const legacy = await seedBoxArt(t, image, "none");
    const approved = await seedBoxArt(t, image, "approved");
    const pending = await seedBoxArt(t, image, "pending");
    const rejected = await seedBoxArt(t, image, "rejected");
    const done = await seedBoxArt(t, await jpeg(400, 300), "approved");
    await t.action(generate, { sourceId: done });
    await t.run(async (ctx) => {
      await ctx.db.insert("puzzles", {
        title: "No image",
        pieceCount: 500,
        status: "approved",
        submittedBy: (await ctx.db.query("users").first())!._id,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    return { legacy, approved, pending, rejected, done };
  };

  const finalTotals = () =>
    logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(
        (line) =>
          line.event === "imageModeration.backfillRenditions" && line.done,
      )
      .pop();

  test("is a dry run by default: counts the box art that would get renditions, writes nothing", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCatalogue(t);
    const before = await storageCount(t);

    expect(await t.action(backfill, {})).toEqual({
      scanned: 6,
      candidates: 2,
      recorded: 0,
      refused: 0,
      failed: 0,
      skipped: 0,
    });

    expect(await storageCount(t)).toBe(before);
    expect(await renditionsOf(t, seeded.legacy)).toEqual([]);
    expect(await renditionsOf(t, seeded.approved)).toEqual([]);
    expect(finalTotals()).toMatchObject({ dry_run: true, candidates: 2 });
  });

  test("a real run covers legacy and approved box art, skips the rest, and continues page by page", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCatalogue(t);
    vi.useFakeTimers();

    await t.action(backfill, { dryRun: false, batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await renditionsOf(t, seeded.legacy)).toHaveLength(1);
    expect(await renditionsOf(t, seeded.approved)).toHaveLength(1);
    expect(await renditionsOf(t, seeded.pending)).toEqual([]);
    expect(await renditionsOf(t, seeded.rejected)).toEqual([]);
    expect(finalTotals()).toMatchObject({
      dry_run: false,
      scanned: 6,
      candidates: 2,
      recorded: 2,
      refused: 0,
      failed: 0,
      skipped: 0,
    });

    // Idempotent: a second run finds nothing left to do.
    const after = await storageCount(t);
    vi.useRealTimers();
    expect(await t.action(backfill, { dryRun: false })).toMatchObject({
      candidates: 0,
      recorded: 0,
    });
    expect(await storageCount(t)).toBe(after);
  });

  test("a storage failure is counted, not retried in the background; a re-run picks it up", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCatalogue(t);
    vi.spyOn(Blob.prototype, "arrayBuffer").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    expect(await t.action(backfill, { dryRun: false })).toMatchObject({
      candidates: 2,
      recorded: 1,
      failed: 1,
    });
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toEqual([]);

    expect(await t.action(backfill, { dryRun: false })).toMatchObject({
      candidates: 1,
      recorded: 1,
      failed: 0,
    });
    expect(await renditionsOf(t, seeded.legacy)).toHaveLength(1);
    expect(await renditionsOf(t, seeded.approved)).toHaveLength(1);
  });
});
