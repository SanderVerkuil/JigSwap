import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteCopyPhoto } from "./admin/deleteCopyPhoto";
import {
  deleteOwnCopies,
  deleteUploadedCopyPhotos,
} from "./conversation/purgeMemberLibrary";
import schema from "./schema";

// Copy-photo renditions (PERF-C1, P-42): a member's photo of their copy gets its 480 and 960 px
// WebP renditions once it is approved (by the pipeline, a re-screen, an admin's decision or a
// restore), and they live exactly as long as the photo: the owner's removal, an admin's
// deletion, account erasure, deleting the copy, a rejection and a quarantine all delete them.
// They are served only behind the photo's own gate (approved and hash-cleared), only as URLs:
// the gallery thumbnails and the cover on cards pick from them, while the lightbox and the copy
// page's cover keep the original. HCS and the classifier are a routed fake `fetch`.

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
type PhotoFields = Partial<
  Pick<
    Doc<"ownedPuzzleImages">,
    | "moderationStatus"
    | "moderationScore"
    | "hashCheckedAt"
    | "hashCheckPendingSince"
    | "hashCheckTimedOutAt"
    | "uploaderId"
  >
>;

// HCS answers `hcs` (a match, no match, or an HTTP status); the classifier scores `nsfw`.
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

// Alice owns one open copy of a definition whose box art is served (legacy, no renditions); Bob
// is the second member (and the admin, when he says so).
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
    const bob = await mkUser("clerk_bob");
    const boxArt = await ctx.storage.store(
      new Blob(["box art"], { type: "image/jpeg" }),
    );
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      image: boxArt,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, boxArt, puzzleAggregateId, copy };
  });
type Seeded = Awaited<ReturnType<typeof seed>>;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

// A photo-like JPEG (a gradient), so the pipeline's re-encode and the renditions really run.
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

const storeBytes = (t: T, bytes: Uint8Array) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type: "image/jpeg" })),
  );

// A photo of `copy` (Alice's seeded one unless given), inserted as the pipeline leaves it.
const seedPhoto = async (
  t: T,
  s: Seeded,
  fields: PhotoFields,
  {
    bytes = new Uint8Array([1, 2, 3]),
    copy = s.copy,
  }: { bytes?: Uint8Array; copy?: Id<"ownedPuzzles"> } = {},
) => {
  const fileId = await storeBytes(t, bytes);
  const imageId = await t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: s.alice,
      fileId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...fields,
    }),
  );
  return { imageId, fileId };
};

// Renditions of a 1600 x 1200 source, as the generation records them (stand-in blobs).
const seedRenditions = (t: T, sourceId: Id<"_storage">) =>
  t.run(async (ctx) => {
    const webp = (body: string) =>
      ctx.storage.store(new Blob([body], { type: "image/webp" }));
    const small = await webp("small rendition");
    const medium = await webp("medium rendition");
    await ctx.db.insert("imageRenditions", {
      sourceId,
      width: 1600,
      height: 1200,
      small: { fileId: small, width: 480, height: 360 },
      medium: { fileId: medium, width: 960, height: 720 },
      createdAt: Date.now(),
    });
    return { small, medium };
  });

const photoRows = (t: T, copy: Id<"ownedPuzzles">) =>
  t.run((ctx) =>
    ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", copy))
      .collect(),
  );

const allRenditions = (t: T) =>
  t.run((ctx) => ctx.db.query("imageRenditions").collect());

const blobIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_storage").collect()).map((blob) => blob._id),
  );

const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

const urlOf = async (t: T, id: Id<"_storage">) => {
  const url = await t.run((ctx) => ctx.storage.getUrl(id));
  if (!url) throw new Error("blob has no URL");
  return url;
};

type GenerationJob = {
  name: string;
  args: { sourceId: Id<"_storage">; attempt?: number }[];
  state: { kind: string };
};
const generationJobs = async (t: T) =>
  (
    (await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )) as unknown as GenerationJob[]
  ).filter((job) => job.name.includes("renditions:generateRenditions"));

// The generateRenditions runs scheduled so far (first attempts), by source.
const scheduledFor = async (t: T) =>
  (await generationJobs(t))
    .filter((job) => job.args[0].attempt === undefined)
    .map((job) => job.args[0].sourceId);

// Let the scheduled generation run. convex-test can fail an action's blob store while another
// function's transaction is open ("Write outside of transaction"), which the action treats as a
// storage failure and retries 30 s later: run such a retry now instead of waiting for it.
const settleRenditions = async (t: T) => {
  await settleDueScheduled(t);
  for (const job of await generationJobs(t)) {
    if (job.state.kind === "pending") {
      await t.action(
        internal.lib.imageModeration.renditions.generateRenditions,
        job.args[0],
      );
    }
  }
};

// Expect `sourceId` (a 1000 x 750 photo) to have its two WebP renditions; returns their blobs.
const expectRenditions = async (t: T, sourceId: Id<"_storage">) => {
  const rows = await allRenditions(t);
  expect(rows).toEqual([
    expect.objectContaining({
      sourceId,
      width: 1000,
      height: 750,
      small: expect.objectContaining({ width: 480, height: 360 }),
      medium: expect.objectContaining({ width: 960, height: 720 }),
    }),
  ]);
  const ids = [rows[0].small!.fileId, rows[0].medium!.fileId];
  for (const id of ids) {
    expect(await t.run(async (ctx) => (await ctx.storage.get(id))?.type)).toBe(
      "image/webp",
    );
  }
  return ids;
};

// Upload a 1000 x 750 photo of Alice's copy and let the pipeline decide it.
const uploadPhoto = async (t: T, s: Seeded) => {
  const upload = await storeBytes(t, await jpeg(1000, 750));
  await asAlice(t).mutation(api.library.addCopyPhoto.addCopyPhoto, {
    copyId: s.copy,
    fileId: upload,
    tag: "box_front",
  });
  await settleDueScheduled(t);
  const [row] = await photoRows(t, s.copy);
  return { row, upload };
};

describe("copy photo renditions: made once the photo is approved", () => {
  test("a clean photo gets them in the background, from its clean blob", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const { row, upload } = await uploadPhoto(t, s);
    expect(row.moderationStatus).toBe("approved");
    // The pipeline swapped the upload for its clean re-encode: that is the source.
    expect(row.fileId).not.toBe(upload);
    expect(await scheduledFor(t)).toEqual([row.fileId]);

    await settleRenditions(t);
    const renditions = await expectRenditions(t, row.fileId);
    expect((await blobIds(t)).sort()).toEqual(
      [s.boxArt, row.fileId, ...renditions].sort(),
    );
  });

  test("a photo the classifier rejects gets none", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);

    const { row } = await uploadPhoto(t, s);
    await settleDueScheduled(t);

    expect(row.moderationStatus).toBe("rejected");
    expect(await scheduledFor(t)).toEqual([]);
    expect(await allRenditions(t)).toEqual([]);
  });

  test.each(["pending", "unscored", "rejected", "quarantined"] as const)(
    "a %s photo gets none and stores nothing",
    async (moderationStatus) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const { fileId } = await seedPhoto(
        t,
        s,
        { moderationStatus },
        { bytes: await jpeg(600, 450) },
      );
      const before = (await blobIds(t)).length;

      expect(
        await t.action(
          internal.lib.imageModeration.renditions.generateRenditions,
          { sourceId: fileId },
        ),
      ).toBe("not_eligible");

      expect(await allRenditions(t)).toEqual([]);
      expect(await blobIds(t)).toHaveLength(before);
    },
  );

  test.each(["approved", "legacy"] as const)(
    "a photo that is %s gets them",
    async (status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const { fileId } = await seedPhoto(
        t,
        s,
        status === "legacy" ? {} : { moderationStatus: status },
        { bytes: await jpeg(1000, 750) },
      );

      expect(
        await t.action(
          internal.lib.imageModeration.renditions.generateRenditions,
          { sourceId: fileId },
        ),
      ).toBe("recorded");
      await expectRenditions(t, fileId);
    },
  );

  test("an admin's approval, a waived hash check and a restore schedule them", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const unscored = await seedPhoto(t, s, {
      moderationStatus: "unscored",
      hashCheckedAt: 1,
    });
    // Approved by the classifier, but its hash check timed out.
    const timedOut = await seedPhoto(t, s, {
      moderationStatus: "approved",
      moderationScore: 0.01,
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
    });
    const rejected = await seedPhoto(t, s, {
      moderationStatus: "rejected",
      moderationScore: 0.99,
    });

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "copy", imageId: unscored.imageId, decision: "approve" },
    );
    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      {
        source: "copy",
        imageId: timedOut.imageId,
        decision: "waive_hash_check",
      },
    );
    await asAdmin(t).mutation(api.admin.restorePhoto.restorePhoto, {
      imageId: rejected.imageId,
    });

    expect(await scheduledFor(t)).toEqual([
      unscored.fileId,
      timedOut.fileId,
      rejected.fileId,
    ]);
  });

  test("an admin's rejection of an approved photo whose hash check timed out deletes them", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      moderationScore: 0.01,
      hashCheckPendingSince: 1,
      hashCheckTimedOutAt: 2,
    });
    const renditions = await seedRenditions(t, photo.fileId);

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "copy", imageId: photo.imageId, decision: "reject" },
    );

    expect(await scheduledFor(t)).toEqual([]);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, renditions.small)).toBe(false);
    expect(await blobExists(t, renditions.medium)).toBe(false);
    // The rejected photo waits in Flagged Images: its own blob stays until the removal.
    expect(await blobExists(t, photo.fileId)).toBe(true);
  });

  test("a re-screen rejection deletes them; a re-screen approval schedules them", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // Approved before the classifier ran (no score), with renditions from the backfill.
    const legacy = await seedPhoto(t, s, {});
    const renditions = await seedRenditions(t, legacy.fileId);
    const unscored = await seedPhoto(t, s, { moderationStatus: "unscored" });

    expect(
      await t.mutation(internal.library.moderationStore.applyRescreenVerdict, {
        imageId: legacy.imageId,
        moderationStatus: "rejected",
        moderationScore: 0.99,
      }),
    ).toBe(true);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, renditions.small)).toBe(false);
    expect(await blobExists(t, renditions.medium)).toBe(false);
    expect(await blobExists(t, legacy.fileId)).toBe(true);

    expect(
      await t.mutation(internal.library.moderationStore.applyRescreenVerdict, {
        imageId: unscored.imageId,
        moderationStatus: "approved",
        moderationScore: 0.01,
      }),
    ).toBe(true);
    expect(await scheduledFor(t)).toEqual([unscored.fileId]);
  });
});

describe("copy photo renditions: deleted with the photo", () => {
  // An approved photo with its renditions; returns every blob that must go with it.
  const photoWithRenditions = async (
    t: T,
    s: Seeded,
    opts: { copy?: Id<"ownedPuzzles">; uploaderId?: Id<"users"> } = {},
  ) => {
    const photo = await seedPhoto(
      t,
      s,
      {
        moderationStatus: "approved",
        moderationScore: 0.01,
        ...(opts.uploaderId && { uploaderId: opts.uploaderId }),
      },
      { copy: opts.copy },
    );
    const { small, medium } = await seedRenditions(t, photo.fileId);
    return { ...photo, small, medium };
  };

  const expectGone = async (
    t: T,
    photo: { small: Id<"_storage">; medium: Id<"_storage"> },
  ) => {
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobExists(t, photo.small)).toBe(false);
    expect(await blobExists(t, photo.medium)).toBe(false);
  };

  test("the owner's removal", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await photoWithRenditions(t, s);

    await asAlice(t).mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: photo.imageId,
    });

    await expectGone(t, photo);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("an admin's removal (a confirmed report or flagged photo)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await photoWithRenditions(t, s);

    await t.run(async (ctx) => {
      const row = await ctx.db.get(photo.imageId);
      await deleteCopyPhoto(ctx, row!, await ctx.db.get(s.copy));
    });

    await expectGone(t, photo);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("account erasure: a photo of a copy they own", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await photoWithRenditions(t, s);

    await t.run((ctx) =>
      deleteOwnCopies(ctx, s.alice, { cursor: null, numItems: 10 }),
    );

    await expectGone(t, photo);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("account erasure: a photo they uploaded to another member's copy", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await photoWithRenditions(t, s, { uploaderId: s.bob });

    await t.run((ctx) =>
      deleteUploadedCopyPhotos(ctx, s.bob, { cursor: null, numItems: 10 }),
    );

    await expectGone(t, photo);
    expect(await blobExists(t, photo.fileId)).toBe(false);
  });

  test("deleting the copy", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const copyId = (await asAlice(t).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: s.puzzleAggregateId, condition: "good" },
    )) as string;
    const copy = await t.run(async (ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
        .unique(),
    );
    const photo = await photoWithRenditions(t, s, { copy: copy!._id });

    await asAlice(t).mutation(api.library.deleteCopy.deleteCopy, { copyId });

    await expectGone(t, photo);
  });

  test("a hash match on re-check deletes them; the escalation is still raised", async () => {
    // Approved by the classifier while the hash check is unavailable: unserved, but its
    // renditions are made (no more exposed than the stored photo, and served only through it).
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    const s = await seed(t);
    const { row } = await uploadPhoto(t, s);
    expect(row.moderationStatus).toBe("approved");
    expect(row.hashCheckedAt).toBeUndefined();
    await settleRenditions(t);
    const renditions = await expectRenditions(t, row.fileId);

    vi.stubGlobal("fetch", routedFetch("match"));
    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId: row._id,
      attempt: 1,
      pooled: true,
    });

    const [quarantined] = await photoRows(t, s.copy);
    expect(quarantined.moderationStatus).toBe("quarantined");
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([
      expect.objectContaining({
        table: "ownedPuzzleImages",
        rowId: row._id,
        fileId: quarantined.fileId,
        status: "open",
      }),
    ]);
    expect(await allRenditions(t)).toEqual([]);
    for (const id of renditions) expect(await blobExists(t, id)).toBe(false);
  });
});

describe("copy photo renditions: served behind the photo's gate, as URLs", () => {
  const srcSetOf = async (
    t: T,
    source: Id<"_storage">,
    r: { small: Id<"_storage">; medium: Id<"_storage"> },
  ) =>
    `${await urlOf(t, r.small)} 480w, ${await urlOf(t, r.medium)} 960w, ${await urlOf(t, source)} 1600w`;

  const expectNoStorageIds = (response: unknown, ids: Id<"_storage">[]) => {
    const json = JSON.stringify(response);
    for (const id of ids) expect(json).not.toContain(id);
  };

  test("an approved photo's gallery thumbnail picks from them; the lightbox keeps the original", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { moderationStatus: "approved" });
    const r = await seedRenditions(t, photo.fileId);

    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.copy },
    );

    expect(view?.gallery).toEqual([
      expect.objectContaining({
        id: photo.imageId,
        url: await urlOf(t, photo.fileId),
        thumbUrl: await urlOf(t, r.small),
        srcSet: await srcSetOf(t, photo.fileId, r),
      }),
    ]);
    expectNoStorageIds(view, [photo.fileId, r.small, r.medium]);
  });

  test("the uploader's own photo still under review is shown as it is", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "pending",
      hashCheckedAt: 1,
    });
    // A leftover row (it cannot normally exist for a pending photo) is not served.
    const r = await seedRenditions(t, photo.fileId);

    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.copy },
    );

    expect(view?.gallery).toHaveLength(1);
    const [entry] = view!.gallery;
    expect(entry.url).toBe(await urlOf(t, photo.fileId));
    expect(entry.thumbUrl).toBeUndefined();
    expect(entry.srcSet).toBeUndefined();
    const json = JSON.stringify(view);
    expect(json).not.toContain(await urlOf(t, r.small));
    expect(json).not.toContain(await urlOf(t, r.medium));
  });

  test("an approved cover photo's card picks from them; the copy page keeps the original", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, { moderationStatus: "approved" });
    const r = await seedRenditions(t, photo.fileId);
    await t.run((ctx) => ctx.db.patch(s.copy, { coverImageId: photo.imageId }));

    const cards = await asAlice(t).query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: s.alice, includeUnavailable: true },
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].coverSrcSet).toBe(await srcSetOf(t, photo.fileId, r));
    // The thumbnail-sized cover other surfaces read (chips, shelves, dialogs).
    expect(cards[0].coverUrl).toBe(await urlOf(t, r.small));
    expectNoStorageIds(cards, [photo.fileId, r.small, r.medium]);

    const view = await asAlice(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.copy },
    );
    expect(view?.snapshot.image).toBe(await urlOf(t, photo.fileId));
  });

  test("a cover photo that has not passed its hash check is not served, nor are its renditions", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const photo = await seedPhoto(t, s, {
      moderationStatus: "approved",
      hashCheckPendingSince: 1,
    });
    const r = await seedRenditions(t, photo.fileId);
    await t.run((ctx) => ctx.db.patch(s.copy, { coverImageId: photo.imageId }));

    const cards = await asAlice(t).query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: s.alice, includeUnavailable: true },
    );

    // The box art instead (served, no renditions of its own).
    expect(cards[0].coverUrl).toBe(await urlOf(t, s.boxArt));
    expect(cards[0].coverSrcSet).toBeUndefined();
    const json = JSON.stringify(cards);
    for (const id of [photo.fileId, r.small, r.medium]) {
      expect(json).not.toContain(await urlOf(t, id));
    }
  });
});

describe("copy photo renditions: the backfill", () => {
  // Six photos: approved and legacy (both get renditions), pending, rejected and quarantined
  // (none), and one approved photo already recorded.
  const seedPhotos = async (t: T, s: Seeded) => {
    const bytes = await jpeg(600, 450);
    const approved = await seedPhoto(
      t,
      s,
      { moderationStatus: "approved" },
      { bytes },
    );
    const legacy = await seedPhoto(t, s, {}, { bytes });
    const pending = await seedPhoto(
      t,
      s,
      { moderationStatus: "pending" },
      { bytes },
    );
    const rejected = await seedPhoto(
      t,
      s,
      { moderationStatus: "rejected" },
      { bytes },
    );
    const quarantined = await seedPhoto(
      t,
      s,
      { moderationStatus: "quarantined" },
      { bytes },
    );
    const done = await seedPhoto(t, s, { moderationStatus: "approved" });
    await seedRenditions(t, done.fileId);
    return { approved, legacy, pending, rejected, quarantined, done };
  };

  const renditionsOf = (t: T, sourceId: Id<"_storage">) =>
    t.run((ctx) =>
      ctx.db
        .query("imageRenditions")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect(),
    );

  const finalTotals = () =>
    logged
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      })
      .filter(
        (line) =>
          line.event === "imageModeration.backfillRenditions" && line.done,
      )
      .pop();

  test("is a dry run by default: counts the photos that would get renditions", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await seedPhotos(t, s);
    const before = (await blobIds(t)).length;

    expect(
      await t.action(
        internal.lib.imageModeration.renditions.backfillRenditions,
        { table: "copy" },
      ),
    ).toEqual({
      scanned: 6,
      candidates: 2,
      recorded: 0,
      refused: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await blobIds(t)).toHaveLength(before);
    expect(finalTotals()).toMatchObject({
      table: "copy",
      dry_run: true,
      candidates: 2,
    });
  });

  test("a real run covers approved and legacy photos, skips the rest, and continues page by page", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const seeded = await seedPhotos(t, s);
    vi.useFakeTimers();

    await t.action(internal.lib.imageModeration.renditions.backfillRenditions, {
      table: "copy",
      dryRun: false,
      batchSize: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const photo of [seeded.approved, seeded.legacy]) {
      expect(await renditionsOf(t, photo.fileId)).toEqual([
        expect.objectContaining({
          width: 600,
          height: 450,
          small: expect.objectContaining({ width: 480, height: 360 }),
        }),
      ]);
    }
    for (const photo of [seeded.pending, seeded.rejected, seeded.quarantined]) {
      expect(await renditionsOf(t, photo.fileId)).toEqual([]);
    }
    expect(finalTotals()).toMatchObject({
      table: "copy",
      dry_run: false,
      scanned: 6,
      candidates: 2,
      recorded: 2,
    });

    // Idempotent: a second run finds nothing left to do.
    vi.useRealTimers();
    expect(
      await t.action(
        internal.lib.imageModeration.renditions.backfillRenditions,
        { table: "copy", dryRun: false },
      ),
    ).toMatchObject({ candidates: 0, recorded: 0 });
  });
});
