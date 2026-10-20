import { convexTest, type TestConvex } from "convex-test";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { moderationPool } from "./lib/imageModeration/moderationPool";
import schema from "./schema";

// Admin review of box art whose check never completed: it shows in the unchecked-photos queue
// (admin/listUncheckedPhotos), an admin approves or rejects it (admin/decideUncheckedPhoto) or
// sends it through the pipeline again (admin/recheckPhoto). The box art reaches "unscored" the
// real way: the classifier is misconfigured (no token) when it is uploaded.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

const seed = (t: TestConvex<typeof schema>) =>
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
    const admin = await mkUser("clerk_admin");
    return { alice, admin };
  });

const jpegBytes = async () => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  return new Uint8Array(await image.getBuffer("image/jpeg"));
};

// Upload box art while the classifier has no token, and submit a definition with it: the box
// art is attached but "unscored", so it is served to no one.
const unscoredBoxArt = async (t: TestConvex<typeof schema>) => {
  const bytes = await jpegBytes();
  const upload = (await t.run((ctx) =>
    ctx.storage.store(new Blob([bytes], { type: "image/jpeg" })),
  )) as Id<"_storage">;
  const image = await asAlice(t).action(
    api.catalog.sanitizeBoxArt.sanitizeBoxArt,
    { storageId: upload },
  );
  await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000, image },
  );
  const row = await t.run(async (ctx) =>
    ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", image))
      .unique(),
  );
  expect(row).toMatchObject({
    moderationStatus: "unscored",
    moderationReason: "missing_token",
  });
  const puzzle = await t.run(async (ctx) =>
    ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", image))
      .unique(),
  );
  return { image, imageId: row!._id, puzzleId: puzzle!._id };
};

const servedImage = async (
  t: TestConvex<typeof schema>,
  puzzleId: Id<"puzzles">,
) =>
  (
    await asAlice(t).query(api.catalog.getPuzzleById.getPuzzleById, {
      puzzleId,
    })
  )?.image ?? null;

const rowOf = (t: TestConvex<typeof schema>, id: Id<"boxArtUploads">) =>
  t.run((ctx) => ctx.db.get(id));

const stamps = (t: TestConvex<typeof schema>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError ? error.data : String(error);
  }
  throw new Error("expected an error");
};

describe("unchecked queue: box art", () => {
  test("lists unscored box art with its puzzle title, image and the re-check option", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId } = await unscoredBoxArt(t);

    const items = await asAdmin(t).query(
      api.admin.listUncheckedPhotos.listUncheckedPhotos,
      {},
    );
    expect(items).toEqual([
      expect.objectContaining({
        key: `boxArt:${imageId}`,
        source: "boxArt",
        imageId,
        status: "unscored",
        reason: "missing_token",
        puzzleTitle: "Mountain Vista",
        uploaderName: expect.any(String),
        canRecheck: true,
        url: expect.any(String),
      }),
    ]);
  });

  test("members are refused", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId } = await unscoredBoxArt(t);
    await expect(
      asAlice(t).query(api.admin.listUncheckedPhotos.listUncheckedPhotos, {}),
    ).rejects.toThrow("Forbidden");
    await expect(
      asAlice(t).mutation(api.admin.decideUncheckedPhoto.decideUncheckedPhoto, {
        source: "boxArt",
        imageId,
        decision: "approve",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      asAlice(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
        source: "boxArt",
        imageId,
      }),
    ).rejects.toThrow("Forbidden");
    expect((await rowOf(t, imageId))?.moderationStatus).toBe("unscored");
  });
});

describe("decideUncheckedPhoto: box art", () => {
  test("approve serves the box art, records the admin and stamps the decision", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { admin } = await seed(t);
    const { imageId, puzzleId } = await unscoredBoxArt(t);
    expect(await servedImage(t, puzzleId)).toBeNull();

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId, decision: "approve" },
    );

    expect(await rowOf(t, imageId)).toMatchObject({
      moderationStatus: "approved",
      moderatedBy: admin,
    });
    expect(await servedImage(t, puzzleId)).toEqual(expect.any(String));
    expect(await stamps(t)).toEqual([
      expect.objectContaining({
        kind: "photo_manually_approved",
        actorId: admin,
        targetLabel: "Mountain Vista",
        targetId: imageId,
      }),
    ]);
    expect(
      await asAdmin(t).query(
        api.admin.listUncheckedPhotos.listUncheckedPhotos,
        {},
      ),
    ).toEqual([]);
  });

  test("reject detaches the box art from the puzzle and deletes its file", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { admin } = await seed(t);
    const { image, imageId, puzzleId } = await unscoredBoxArt(t);

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId, decision: "reject" },
    );

    expect(await rowOf(t, imageId)).toMatchObject({
      moderationStatus: "rejected",
      moderatedBy: admin,
    });
    expect((await t.run((ctx) => ctx.db.get(puzzleId)))?.image).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.system.get(image))).toBeNull();
    expect(await stamps(t)).toEqual([
      expect.objectContaining({
        kind: "photo_manually_rejected",
        targetLabel: "Mountain Vista",
      }),
    ]);
  });

  test("box art whose hash check has not passed cannot be decided", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId } = await unscoredBoxArt(t);
    await t.run((ctx) =>
      ctx.db.patch(imageId, {
        hashCheckedAt: undefined,
        hashCheckPendingSince: Date.now(),
      }),
    );
    expect(
      await errorOf(
        asAdmin(t).mutation(
          api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
          { source: "boxArt", imageId, decision: "approve" },
        ),
      ),
    ).toBe("Photo has not passed the hash check yet");
  });

  test("decided box art cannot be decided again", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId } = await unscoredBoxArt(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId, decision: "approve" },
    );
    expect(
      await errorOf(
        asAdmin(t).mutation(
          api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
          { source: "boxArt", imageId, decision: "reject" },
        ),
      ),
    ).toBe("Photo is already decided");
  });
});

describe("recheckPhoto: box art", () => {
  test("puts unscored box art back to pending and the pipeline approves it once the classifier works", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId, puzzleId } = await unscoredBoxArt(t);
    const enqueued = vi.spyOn(moderationPool, "enqueueAction");
    // Hold the pool's check (it would otherwise run on a timer) to see the row as recheck left it.
    vi.useFakeTimers();

    await asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
      source: "boxArt",
      imageId,
    });
    const pending = await rowOf(t, imageId);
    expect(pending).toMatchObject({ moderationStatus: "pending" });
    expect(pending?.moderationReason).toBeUndefined();
    expect(pending?.recheckedAt).toEqual(expect.any(Number));
    expect(
      enqueued.mock.calls.map((call) => [getFunctionName(call[1]), call[2]]),
    ).toEqual([
      ["catalog/moderateBoxArt:moderateBoxArt", { imageId, pooled: true }],
    ]);

    // The classifier is configured again: let the pool run the check.
    vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ label: "nsfw", score: 0.01 }]), {
            status: 200,
          }),
      ),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    expect(await rowOf(t, imageId)).toMatchObject({
      moderationStatus: "approved",
      moderationAttempts: 1,
    });
    expect(await servedImage(t, puzzleId)).toEqual(expect.any(String));
  });

  test("only unscored box art can be checked again", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { imageId } = await unscoredBoxArt(t);
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId, decision: "approve" },
    );
    expect(
      await errorOf(
        asAdmin(t).mutation(api.admin.recheckPhoto.recheckPhoto, {
          source: "boxArt",
          imageId,
        }),
      ),
    ).toBe("Only unchecked photos can be checked again");
  });
});
