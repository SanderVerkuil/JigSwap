import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { findMetadata } from "./lib/imageModeration/stripMetadata";
import schema from "./schema";

// The one-shot metadata strip of images stored before every path stripped them: box art,
// proposed box art, and copy/completion photos the pipeline did not re-encode (WebP, legacy).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../test-fixtures/images/${name}`, import.meta.url)),
  );
const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

const store = (t: TestConvex<typeof schema>, bytes: Uint8Array, type: string) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type })),
  ) as Promise<Id<"_storage">>;

const bytesOf = async (t: TestConvex<typeof schema>, id: Id<"_storage">) => {
  const buffer = await t.run(async (ctx) =>
    (await ctx.storage.get(id))?.arrayBuffer(),
  );
  return buffer ? new Uint8Array(buffer) : null;
};

const seed = async (t: TestConvex<typeof schema>) => {
  const gpsJpeg = await store(t, fixture("gps.jpg"), "image/jpeg");
  const gpsPng = await store(t, fixture("gps.png"), "image/png");
  const gpsWebp = await store(t, fixture("gps.webp"), "image/webp");
  const pendingWebp = await store(
    t,
    new Uint8Array([...fixture("gps.webp"), 0, 0]),
    "image/webp",
  );
  const cleanJpeg = await store(
    t,
    new Uint8Array(
      await new Jimp({ width: 8, height: 8, color: 0x336699ff }).getBuffer(
        "image/jpeg",
      ),
    ),
    "image/jpeg",
  );
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzle = (aggregateId: string, image: Id<"_storage">) =>
      ctx.db.insert("puzzles", {
        aggregateId,
        title: aggregateId,
        pieceCount: 1000,
        status: "approved",
        submittedBy: alice,
        image,
        createdAt: now,
        updatedAt: now,
      });
    const withGps = await puzzle("with-gps", gpsJpeg);
    const clean = await puzzle("clean", cleanJpeg);
    const proposal = await ctx.db.insert("puzzleChangeProposals", {
      aggregateId: "proposal-1",
      puzzleDefinitionId: "with-gps",
      proposedBy: alice,
      status: "pending",
      changes: { image: gpsPng },
      baseline: { image: gpsJpeg },
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-1",
      puzzleDefinitionId: "clean",
      puzzleId: clean,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "clean", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const photo = (fileId: Id<"_storage">, status: "approved" | "pending") =>
      ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: alice,
        fileId,
        moderationStatus: status,
        createdAt: now,
        updatedAt: now,
      });
    return {
      withGps,
      clean,
      proposal,
      approvedPhoto: await photo(gpsWebp, "approved"),
      pendingPhoto: await photo(pendingWebp, "pending"),
    };
  });
  return { ...ids, gpsJpeg, gpsPng, gpsWebp, pendingWebp, cleanJpeg };
};

const run = (
  t: TestConvex<typeof schema>,
  table: "boxArt" | "proposals" | "copy",
  dryRun?: boolean,
) =>
  t.action(
    internal.lib.imageModeration.backfillStripMetadata.backfillStripMetadata,
    { table, ...(dryRun === undefined ? {} : { dryRun }) },
  );

describe("backfillStripMetadata", () => {
  test("is a dry run by default: counts, writes nothing", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    expect(await run(t, "boxArt")).toEqual({
      scanned: 2,
      withMetadata: 1,
      stripped: 0,
      clean: 1,
      skipped: 0,
    });
    const puzzle = await t.run((ctx) => ctx.db.get(seeded.withGps));
    expect(puzzle?.image).toBe(seeded.gpsJpeg);
    expect(await bytesOf(t, seeded.gpsJpeg)).toEqual(fixture("gps.jpg"));
  });

  test("box art: stripped, the definition and its proposal baselines switched, the old blob deleted", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    expect(await run(t, "boxArt", false)).toMatchObject({
      withMetadata: 1,
      stripped: 1,
      clean: 1,
    });

    const puzzle = await t.run((ctx) => ctx.db.get(seeded.withGps));
    expect(puzzle?.image).not.toBe(seeded.gpsJpeg);
    const clean = (await bytesOf(t, puzzle!.image!))!;
    expect(findMetadata(clean, "jpeg")).toEqual([]);
    expect(latin1(clean)).not.toContain("Kerkstraat");
    const proposal = await t.run((ctx) => ctx.db.get(seeded.proposal));
    expect(proposal?.baseline.image).toBe(puzzle?.image);
    expect(proposal?.changes.image).toBe(seeded.gpsPng);
    expect(await bytesOf(t, seeded.gpsJpeg)).toBeNull();
    // Already clean box art is left exactly as it was.
    const untouched = await t.run((ctx) => ctx.db.get(seeded.clean));
    expect(untouched?.image).toBe(seeded.cleanJpeg);
    // Re-runnable: nothing left to strip.
    expect(await run(t, "boxArt", false)).toMatchObject({
      withMetadata: 0,
      clean: 2,
    });
  });

  test("proposed box art is stripped and the proposal switched", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    expect(await run(t, "proposals", false)).toMatchObject({ stripped: 1 });

    const proposal = await t.run((ctx) => ctx.db.get(seeded.proposal));
    expect(proposal?.changes.image).not.toBe(seeded.gpsPng);
    const clean = (await bytesOf(
      t,
      proposal!.changes.image as Id<"_storage">,
    ))!;
    expect(findMetadata(clean, "png")).toEqual([]);
    expect(await bytesOf(t, seeded.gpsPng)).toBeNull();
  });

  test("copy photos: a decided WebP is stripped; a pending one is left to the pipeline", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    expect(await run(t, "copy", false)).toMatchObject({
      scanned: 2,
      stripped: 1,
      skipped: 1,
    });

    const approved = await t.run((ctx) => ctx.db.get(seeded.approvedPhoto));
    expect(approved?.fileId).not.toBe(seeded.gpsWebp);
    expect(findMetadata((await bytesOf(t, approved!.fileId))!, "webp")).toEqual(
      [],
    );
    expect(await bytesOf(t, seeded.gpsWebp)).toBeNull();
    const pending = await t.run((ctx) => ctx.db.get(seeded.pendingPhoto));
    expect(pending?.fileId).toBe(seeded.pendingWebp);
  });
});
