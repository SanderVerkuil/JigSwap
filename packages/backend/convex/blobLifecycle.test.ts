import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  deleteOwnCopies,
  purgeCompletions,
} from "./conversation/purgeMemberLibrary";
import { deleteBlobUnlessReferenced } from "./lib/storage/blobLifecycle";
import schema from "./schema";

// SEC-01 defence in depth: a delete path never removes a blob that another row still holds. Rows
// written before the claim rule (lib/storage/claimFreshUpload) may hold catalogue box art; removing
// them, deleting their completion, the moderation pipeline's swap or refusal, an admin removal
// and the account purge must all leave the box art in place, while an own blob still goes.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "none");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const HOUR = 60 * 60 * 1000;

// A real, unique JPEG, so the pipeline re-encodes it and swaps the row to the clean blob.
const jpegBytes = async () =>
  new Uint8Array(
    await new Jimp({
      width: 8,
      height: 8,
      color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
    }).getBuffer("image/jpeg"),
  );

const store = (t: T, bytes: BlobPart, type: string) =>
  t.run(
    (ctx) =>
      ctx.storage.store(new Blob([bytes], { type })) as Promise<Id<"_storage">>,
  );
const storeJpeg = async (t: T) => store(t, await jpegBytes(), "image/jpeg");
// Unique non-image bytes: the pipeline's input guards refuse them.
const storeJunk = (t: T) => store(t, crypto.randomUUID(), "image/png");

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

// Alice's approved puzzle holds `boxArt` (a JPEG); a second, legacy definition holds `legacyArt`
// (bytes the pipeline's guards refuse). Mallory owns a copy of the puzzle.
const seed = async (t: T) => {
  const boxArt = await storeJpeg(t);
  const legacyArt = await storeJunk(t);
  return t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice");
    const mallory = await mkUser("clerk_mallory");
    await mkUser("clerk_admin");
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      image: boxArt,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const legacyPuzzleId = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Old Harbour",
      pieceCount: 500,
      image: legacyArt,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copyAggregateId = crypto.randomUUID();
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: definitionId,
      puzzleId,
      ownerId: mallory,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return {
      mallory,
      boxArt,
      legacyArt,
      puzzleId,
      legacyPuzzleId,
      copy,
      copyAggregateId,
    };
  });
};

type Seeded = Awaited<ReturnType<typeof seed>>;

const asMallory = (t: T) => t.withIdentity({ subject: "clerk_mallory" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

// A copy photo row written before the claim rule, holding whatever blob it was given.
const legacyCopyPhoto = (
  t: T,
  s: Seeded,
  fileId: Id<"_storage">,
  moderationStatus?: "pending" | "rejected",
) =>
  t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: s.copy,
      uploaderId: s.mallory,
      fileId,
      moderationStatus,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

// Mallory's completion of her copy, its `photos` and sidecars holding `fileIds` (legacy shape).
const legacyCompletion = async (
  t: T,
  s: Seeded,
  fileIds: Id<"_storage">[],
  moderationStatus?: "pending",
) => {
  const { completionId } = await asMallory(t).mutation(
    api.solving.recordCompletion.recordCompletion,
    {
      copyId: s.copyAggregateId,
      startDate: Date.now() - 2 * HOUR,
      endDate: Date.now() - HOUR,
    },
  );
  const sidecars = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
      .unique();
    await ctx.db.patch(row!._id, { photos: fileIds });
    const ids: Id<"completionImages">[] = [];
    for (const fileId of fileIds) {
      ids.push(
        await ctx.db.insert("completionImages", {
          completionId,
          uploaderId: s.mallory,
          fileId,
          moderationStatus,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );
    }
    return ids;
  });
  return { completionId, sidecars };
};

const definitionImage = (t: T, id: Id<"puzzles">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.image);

describe("deleteBlobUnlessReferenced", () => {
  test("deletes a blob nothing holds, keeps a held one, and reports a missing one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const own = await storeJunk(t);
    const rowId = await legacyCopyPhoto(t, s, own);

    expect(
      await t.run((ctx) => deleteBlobUnlessReferenced(ctx, s.boxArt)),
    ).toBe("referenced");
    expect(await t.run((ctx) => deleteBlobUnlessReferenced(ctx, own))).toBe(
      "referenced",
    );
    // The row being removed is left out.
    expect(
      await t.run((ctx) =>
        deleteBlobUnlessReferenced(ctx, own, { except: rowId }),
      ),
    ).toBe("deleted");
    expect(await blobExists(t, own)).toBe(false);
    expect(await t.run((ctx) => deleteBlobUnlessReferenced(ctx, own))).toBe(
      "missing",
    );
    expect(await blobExists(t, s.boxArt)).toBe(true);
  });
});

describe("delete paths keep a blob another row holds", () => {
  test("removeCopyPhoto", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const own = await storeJunk(t);
    const onBoxArt = await legacyCopyPhoto(t, s, s.boxArt);
    const ownRow = await legacyCopyPhoto(t, s, own);

    for (const imageId of [onBoxArt, ownRow]) {
      await asMallory(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId,
      });
    }

    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect(await definitionImage(t, s.puzzleId)).toBe(s.boxArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("deleteCompletion", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const own = await storeJunk(t);
    const { completionId } = await legacyCompletion(t, s, [s.boxArt, own]);

    await asMallory(t).mutation(api.solving.deleteCompletion.deleteCompletion, {
      completionId,
    });

    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect(await definitionImage(t, s.puzzleId)).toBe(s.boxArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("the pipeline's swap keeps the original another row holds", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const own = await storeJpeg(t);
    const onBoxArt = await legacyCopyPhoto(t, s, s.boxArt, "pending");
    const ownRow = await legacyCopyPhoto(t, s, own, "pending");

    for (const imageId of [onBoxArt, ownRow]) {
      await t.action(internal.library.moderatePhoto.moderatePhoto, {
        imageId,
      });
    }

    const rows = await t.run(async (ctx) => ({
      onBoxArt: await ctx.db.get(onBoxArt),
      own: await ctx.db.get(ownRow),
    }));
    // Both were re-encoded and moved to their clean blob.
    expect(rows.onBoxArt?.moderationStatus).toBe("approved");
    expect(rows.onBoxArt?.fileId).not.toBe(s.boxArt);
    expect(rows.own?.fileId).not.toBe(own);
    // The box art stays; the own original goes.
    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect(await definitionImage(t, s.puzzleId)).toBe(s.boxArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("the pipeline's refusal keeps a blob another row holds", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const own = await storeJunk(t);
    const onLegacyArt = await legacyCopyPhoto(t, s, s.legacyArt, "pending");
    const ownRow = await legacyCopyPhoto(t, s, own, "pending");

    for (const imageId of [onLegacyArt, ownRow]) {
      await t.action(internal.library.moderatePhoto.moderatePhoto, {
        imageId,
      });
    }

    const statuses = await t.run(async (ctx) => [
      (await ctx.db.get(onLegacyArt))?.moderationStatus,
      (await ctx.db.get(ownRow))?.moderationStatus,
    ]);
    expect(statuses).toEqual(["rejected", "rejected"]);
    expect(await blobExists(t, s.legacyArt)).toBe(true);
    expect(await definitionImage(t, s.legacyPuzzleId)).toBe(s.legacyArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("a rejected completion photo keeps a blob another row holds", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const own = await storeJunk(t);
    const {
      completionId,
      sidecars: [onLegacyArt, ownSidecar],
    } = await legacyCompletion(t, s, [s.legacyArt, own], "pending");

    for (const imageId of [onLegacyArt, ownSidecar]) {
      await t.action(
        internal.solving.moderateCompletionPhoto.moderateCompletionPhoto,
        { imageId },
      );
    }

    const photos = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("completions")
            .withIndex("by_aggregate_id", (q) =>
              q.eq("aggregateId", completionId),
            )
            .unique()
        )?.photos,
    );
    // Both are rejected and dropped from the completion.
    expect(photos).toEqual([]);
    expect(await blobExists(t, s.legacyArt)).toBe(true);
    expect(await definitionImage(t, s.legacyPuzzleId)).toBe(s.legacyArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("an admin's photo removal", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const own = await storeJunk(t);
    const onBoxArt = await legacyCopyPhoto(t, s, s.boxArt, "rejected");
    const ownRow = await legacyCopyPhoto(t, s, own, "rejected");

    for (const imageId of [onBoxArt, ownRow]) {
      await asAdmin(t).mutation(
        api.admin.confirmPhotoRemoval.confirmPhotoRemoval,
        { imageId },
      );
    }

    expect(
      await t.run((ctx) => ctx.db.query("ownedPuzzleImages").collect()),
    ).toEqual([]);
    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect(await definitionImage(t, s.puzzleId)).toBe(s.boxArt);
    expect(await blobExists(t, own)).toBe(false);
  });

  test("the account purge", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const ownPhoto = await storeJunk(t);
    const ownSolvePhoto = await storeJunk(t);
    await legacyCopyPhoto(t, s, s.boxArt);
    await legacyCopyPhoto(t, s, ownPhoto);
    await legacyCompletion(t, s, [s.boxArt, ownSolvePhoto]);

    const page = { cursor: null, numItems: 50 };
    await t.run((ctx) => deleteOwnCopies(ctx, s.mallory, page));
    await t.run((ctx) => purgeCompletions(ctx, s.mallory, page));

    expect(await t.run((ctx) => ctx.db.get(s.copy))).toBeNull();
    expect(await blobExists(t, s.boxArt)).toBe(true);
    expect(await definitionImage(t, s.puzzleId)).toBe(s.boxArt);
    expect(await blobExists(t, ownPhoto)).toBe(false);
    expect(await blobExists(t, ownSolvePhoto)).toBe(false);
  });
});
