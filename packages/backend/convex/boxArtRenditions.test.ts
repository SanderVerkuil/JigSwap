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

// The box-art lifecycle of renditions (PERF-C1, P-42): box art gets its 480 and 960 px WebP
// renditions in the background once it is approved (by the pipeline, a re-screen or an admin),
// never while the uploader waits; whenever box art is rejected or quarantined its renditions and
// their blobs are deleted with it. HCS and the classifier are a routed fake `fetch`.

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const HCS_URL = "https://hcs.example.test/api/check";
const HF_HOST = "router.huggingface.co";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
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
});

type T = TestConvex<typeof schema>;

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

const seed = (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name: clerkId,
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
    return {
      alice: await mkUser("clerk_alice"),
      bob: await mkUser("clerk_bob"),
    };
  });

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_bob", metadata: { role: "admin" } });

// A 1000x750 photo-like JPEG (a gradient), wide enough for both renditions.
const jpeg = async () => {
  const [width, height] = [1000, 750];
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

const storeBytes = async (t: T, bytes: Uint8Array) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([bytes as BlobPart], { type: "image/jpeg" })),
  );

// Upload box art and run the uploader's inline check: the clean blob's id, or the refusal.
const sanitize = async (t: T, bytes: Uint8Array) => {
  const storageId = await storeBytes(t, bytes);
  try {
    return await asAlice(t).action(api.catalog.sanitizeBoxArt.sanitizeBoxArt, {
      storageId,
    });
  } catch (error) {
    if (error instanceof ConvexError) return null;
    throw error;
  }
};

const listing = async (t: T) => {
  const rows = await t.run((ctx) => ctx.db.query("boxArtUploads").collect());
  expect(rows).toHaveLength(1);
  return rows[0];
};

const allRenditions = (t: T) =>
  t.run((ctx) => ctx.db.query("imageRenditions").collect());

const blobIds = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_storage").collect()).map((blob) => blob._id),
  );

const blobType = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(id))?.type ?? null);

// The generateRenditions runs scheduled so far, by source.
const scheduledFor = async (t: T) =>
  (
    (await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )) as unknown as { name: string; args: { sourceId: string }[] }[]
  )
    .filter((job) => job.name.includes("renditions:generateRenditions"))
    .map((job) => job.args[0].sourceId);

// Expect `sourceId` to have its two WebP renditions; returns their blob ids.
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
  for (const id of ids) expect(await blobType(t, id)).toBe("image/webp");
  return ids;
};

describe("box art renditions: made once approved", () => {
  test("clean box art gets them in the background, after the uploader's check", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);

    const image = await sanitize(t, await jpeg());
    expect(image).not.toBeNull();
    expect(await listing(t)).toMatchObject({
      storageId: image,
      moderationStatus: "approved",
    });
    // Scheduled by the verdict, not made inside the check.
    expect(await scheduledFor(t)).toEqual([image]);

    await settleDueScheduled(t);
    const renditions = await expectRenditions(t, image!);
    expect((await blobIds(t)).sort()).toEqual([image, ...renditions].sort());
  });

  test("box art the classifier refuses gets none and leaves no blob", async () => {
    vi.stubGlobal("fetch", routedFetch("no_match", 0.99));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);

    expect(await sanitize(t, await jpeg())).toBeNull();
    await settleDueScheduled(t);

    expect((await listing(t)).moderationStatus).toBe("rejected");
    expect(await scheduledFor(t)).toEqual([]);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobIds(t)).toEqual([]);
  });
});

describe("box art renditions: deleted with the box art", () => {
  // Approved by the classifier while the hash check is unavailable: the box art is unserved, but
  // its renditions are made (no more exposed than the stored blob, and served only through it).
  const approvedUnchecked = async (t: T) => {
    vi.stubGlobal("fetch", routedFetch(503));
    const image = (await sanitize(t, await jpeg()))!;
    const row = await listing(t);
    expect(row).toMatchObject({
      storageId: image,
      moderationStatus: "approved",
    });
    expect(row.hashCheckedAt).toBeUndefined();
    await settleDueScheduled(t);
    return { image, row, renditions: await expectRenditions(t, image) };
  };

  test("a hash match on re-check deletes them; the escalation is still raised", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { image, row } = await approvedUnchecked(t);

    vi.stubGlobal("fetch", routedFetch("match"));
    await t.action(internal.catalog.moderateBoxArt.recheckHashes, {
      imageId: row._id,
      attempt: 1,
      pooled: true,
    });

    const quarantined = await listing(t);
    expect(quarantined.moderationStatus).toBe("quarantined");
    const escalations = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    expect(escalations).toEqual([
      expect.objectContaining({
        table: "boxArtUploads",
        rowId: row._id,
        fileId: quarantined.storageId,
        status: "open",
      }),
    ]);
    expect(await allRenditions(t)).toEqual([]);
    // Only the preserved evidence is left: the box art and both renditions are gone.
    expect(await blobIds(t)).toEqual([quarantined.storageId]);
    expect(quarantined.storageId).not.toBe(image);
  });

  test("an admin's rejection deletes them and makes none", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const { image, row } = await approvedUnchecked(t);
    // The re-checks ran out: the box art waits on an admin.
    await t.run((ctx) =>
      ctx.db.patch(row._id, { hashCheckTimedOutAt: Date.now() }),
    );

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId: row._id, decision: "reject" },
    );
    await settleDueScheduled(t);

    expect((await listing(t)).moderationStatus).toBe("rejected");
    expect(await scheduledFor(t)).toEqual([image]);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobIds(t)).toEqual([]);
  });

  test("a re-screen rejection deletes them; a re-screen approval makes them", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const { alice } = await seed(t);
    // Box art from before it was classified: approved without a score, and one never scored.
    const seedListing = async (moderationStatus?: "unscored") => {
      const storageId = await storeBytes(t, await jpeg());
      const imageId = await t.run((ctx) =>
        ctx.db.insert("boxArtUploads", {
          storageId,
          uploaderId: alice,
          ...(moderationStatus && { moderationStatus }),
          createdAt: 1,
        }),
      );
      return { storageId, imageId };
    };
    const legacy = await seedListing();
    await t.action(internal.lib.imageModeration.renditions.generateRenditions, {
      sourceId: legacy.storageId,
    });
    await expectRenditions(t, legacy.storageId);

    expect(
      await t.mutation(
        internal.catalog.boxArtModerationStore.applyRescreenVerdict,
        {
          imageId: legacy.imageId,
          moderationStatus: "rejected",
          moderationScore: 0.99,
        },
      ),
    ).toBe(true);
    expect(await allRenditions(t)).toEqual([]);
    expect(await blobIds(t)).toEqual([]);

    const unscored = await seedListing("unscored");
    expect(
      await t.mutation(
        internal.catalog.boxArtModerationStore.applyRescreenVerdict,
        {
          imageId: unscored.imageId,
          moderationStatus: "approved",
          moderationScore: 0.01,
        },
      ),
    ).toBe(true);
    expect(await scheduledFor(t)).toEqual([unscored.storageId]);
    await settleDueScheduled(t);
    await expectRenditions(t, unscored.storageId);
  });
});

describe("box art renditions: an admin's approval", () => {
  test("approving unscored box art makes them", async () => {
    // The classifier has no token: the box art is left "unscored" for an admin.
    vi.stubEnv("HF_MODERATION_TOKEN", "");
    vi.stubGlobal("fetch", routedFetch("no_match"));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const image = (await sanitize(t, await jpeg()))!;
    const row = await listing(t);
    expect(row.moderationStatus).toBe("unscored");
    await settleDueScheduled(t);
    expect(await scheduledFor(t)).toEqual([]);

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId: row._id, decision: "approve" },
    );
    expect(await scheduledFor(t)).toEqual([image]);
    await settleDueScheduled(t);

    await expectRenditions(t, image);
  });

  test("approving box art without its timed-out hash check makes them", async () => {
    vi.stubEnv("HF_MODERATION_TOKEN", "");
    vi.stubGlobal("fetch", routedFetch(503));
    const t = withModerationPool(convexTest(schema, modules));
    await seed(t);
    const image = (await sanitize(t, await jpeg()))!;
    const row = await listing(t);
    expect(row.moderationStatus).toBe("unscored");
    await settleDueScheduled(t);
    await t.run((ctx) =>
      ctx.db.patch(row._id, { hashCheckTimedOutAt: Date.now() }),
    );

    await asAdmin(t).mutation(
      api.admin.decideUncheckedPhoto.decideUncheckedPhoto,
      { source: "boxArt", imageId: row._id, decision: "waive_hash_check" },
    );
    expect(await scheduledFor(t)).toEqual([image]);
    await settleDueScheduled(t);

    await expectRenditions(t, image);
  });
});
