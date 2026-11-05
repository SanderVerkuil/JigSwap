import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Box-art renditions on the public surfaces (PERF-C1, P-42): the /catalog cards carry an
// `imageSrcSet` (480 w, 640 w, 960 w and the original, or a WebP at the source's own width in
// its place) and the landing plank a `thumbUrl` (the 480 px rendition), but only for box art the
// publication gate (boxArtUrl) serves, and only as URLs. Without renditions (before the
// backfill, or a source with nothing smaller to offer) both read exactly as before: `image`
// alone.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Listing = Partial<
  Pick<
    Doc<"boxArtUploads">,
    "moderationStatus" | "hashCheckedAt" | "hashCheckPendingSince"
  >
>;

// What the renditions row records: every slot (a 1600 px source); 480 and 640 plus a WebP at
// the source's own width (an 833 px source); 480 and 640 only (a 1000 px source whose 960 px
// WebP came out no smaller); a row without slots (nothing smaller to offer); or no row at all
// (not made yet).
type Renditions = "all" | "ownWidth" | "notSmaller" | "noSlots" | "none";

type Seeded = {
  image: Id<"_storage">;
  small?: Id<"_storage">;
  medium?: Id<"_storage">;
  large?: Id<"_storage">;
};

// One approved definition whose box art is listed with `listing` (or not listed: legacy).
const seed = (t: T, listing: Listing | null, renditions: Renditions) =>
  t.run(async (ctx): Promise<Seeded> => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const image = await ctx.storage.store(
      new Blob(["box art"], { type: "image/jpeg" }),
    );
    if (listing) {
      await ctx.db.insert("boxArtUploads", {
        storageId: image,
        uploaderId: alice,
        createdAt: now,
        ...listing,
      });
    }
    await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      image,
      createdAt: now,
      updatedAt: now,
    });
    if (renditions === "none") return { image };
    const webp = (body: string) =>
      ctx.storage.store(new Blob([body], { type: "image/webp" }));
    const width = { all: 1600, ownWidth: 833, notSmaller: 1000, noSlots: 400 }[
      renditions
    ];
    type Slot = { fileId: Id<"_storage">; width: number; height: number };
    const slot = async (name: string, w: number): Promise<Slot> => ({
      fileId: await webp(`${name} rendition`),
      width: w,
      height: Math.round((w * 3) / 4),
    });
    const slots: { small?: Slot; medium?: Slot; large?: Slot } =
      renditions === "noSlots"
        ? {}
        : {
            small: await slot("small", 480),
            medium: await slot("medium", 640),
            ...(renditions !== "notSmaller" && {
              large: await slot("large", Math.min(960, width)),
            }),
          };
    await ctx.db.insert("imageRenditions", {
      sourceId: image,
      width,
      height: Math.round((width * 3) / 4),
      ...slots,
      createdAt: now,
    });
    return {
      image,
      small: slots.small?.fileId,
      medium: slots.medium?.fileId,
      large: slots.large?.fileId,
    };
  });

const urlOf = async (t: T, id: Id<"_storage">) => {
  const url = await t.run((ctx) => ctx.storage.getUrl(id));
  if (!url) throw new Error("blob has no URL");
  return url;
};

const catalogCard = async (t: T) => {
  const result = await t.query(
    api.catalog.browsePublicCatalog.browsePublicCatalog,
    { paginationOpts: { numItems: 20, cursor: null } },
  );
  expect(result.page).toHaveLength(1);
  return result.page[0];
};

const plankBox = async (t: T) => {
  const result = await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
    limit: 12,
    seed: 1,
  });
  expect(result).toHaveLength(1);
  return result[0];
};

const SERVED = [
  ["not listed (legacy)", null],
  ["listed before box art was moderated", {}],
  [
    "approved, hash check passed",
    { moderationStatus: "approved", hashCheckedAt: 1 },
  ],
] as const;

const NOT_SERVED = [
  ["pending", { moderationStatus: "pending", hashCheckPendingSince: 1 }],
  [
    "approved but the hash check still waiting",
    { moderationStatus: "approved", hashCheckPendingSince: 1 },
  ],
  ["unscored", { moderationStatus: "unscored", hashCheckedAt: 1 }],
  ["rejected", { moderationStatus: "rejected", hashCheckedAt: 1 }],
  [
    "quarantined",
    { moderationStatus: "quarantined", hashCheckPendingSince: 1 },
  ],
] as const;

describe("public catalogue cards: imageSrcSet", () => {
  test.each(SERVED)(
    "served box art with renditions: %s",
    async (_n, listing) => {
      const t = convexTest(schema, modules);
      const { image, small, medium, large } = await seed(t, listing, "all");
      const [imageUrl, smallUrl, mediumUrl, largeUrl] = await Promise.all([
        urlOf(t, image),
        urlOf(t, small!),
        urlOf(t, medium!),
        urlOf(t, large!),
      ]);

      const card = await catalogCard(t);
      expect(card.image).toBe(imageUrl);
      expect(card.imageSrcSet).toBe(
        `${smallUrl} 480w, ${mediumUrl} 640w, ${largeUrl} 960w, ${imageUrl} 1600w`,
      );
    },
  );

  test.each(NOT_SERVED)(
    "box art the gate withholds shows no image and no srcSet, even with renditions: %s",
    async (_n, listing) => {
      const t = convexTest(schema, modules);
      await seed(t, listing, "all");

      const card = await catalogCard(t);
      expect(card.image).toBeNull();
      expect(card).not.toHaveProperty("imageSrcSet");
    },
  );

  test("before the backfill (no renditions row) the card carries the original only", async () => {
    const t = convexTest(schema, modules);
    const { image } = await seed(t, null, "none");

    const card = await catalogCard(t);
    expect(card.image).toBe(await urlOf(t, image));
    expect(card).not.toHaveProperty("imageSrcSet");
  });

  test("a source with nothing smaller to offer (a row without slots) carries the original only", async () => {
    const t = convexTest(schema, modules);
    const { image } = await seed(t, null, "noSlots");

    const card = await catalogCard(t);
    expect(card.image).toBe(await urlOf(t, image));
    expect(card).not.toHaveProperty("imageSrcSet");
  });

  test("a source narrower than 960 px offers a WebP at its own width instead of the original", async () => {
    const t = convexTest(schema, modules);
    const { image, small, medium, large } = await seed(t, null, "ownWidth");

    const card = await catalogCard(t);
    expect(card.image).toBe(await urlOf(t, image));
    expect(card.imageSrcSet).toBe(
      `${await urlOf(t, small!)} 480w, ${await urlOf(t, medium!)} 640w, ${await urlOf(t, large!)} 833w`,
    );
  });

  test("a source whose 960 px WebP came out no smaller offers the original above 640 px", async () => {
    const t = convexTest(schema, modules);
    const { image, small, medium } = await seed(t, null, "notSmaller");

    const card = await catalogCard(t);
    expect(card.imageSrcSet).toBe(
      `${await urlOf(t, small!)} 480w, ${await urlOf(t, medium!)} 640w, ${await urlOf(t, image)} 1000w`,
    );
  });

  test("a rendition blob that is gone is left out of the srcSet", async () => {
    const t = convexTest(schema, modules);
    const { image, small, medium, large } = await seed(t, null, "all");
    const imageUrl = await urlOf(t, image);
    await t.run((ctx) => ctx.storage.delete(small!));

    const card = await catalogCard(t);
    expect(card.imageSrcSet).toBe(
      `${await urlOf(t, medium!)} 640w, ${await urlOf(t, large!)} 960w, ${imageUrl} 1600w`,
    );
  });

  test("the response carries URLs only, never a source or rendition storage id", async () => {
    const t = convexTest(schema, modules);
    const { image, small, medium, large } = await seed(t, null, "all");

    const raw = JSON.stringify(
      await t.query(api.catalog.browsePublicCatalog.browsePublicCatalog, {
        paginationOpts: { numItems: 20, cursor: null },
      }),
    );
    expect(raw).toContain("480w");
    for (const id of [image, small!, medium!, large!]) {
      expect(raw).not.toContain(id);
    }
  });
});

describe("landing plank: thumbUrl", () => {
  test.each(SERVED)(
    "served box art with renditions: %s",
    async (_n, listing) => {
      const t = convexTest(schema, modules);
      const { image, small } = await seed(t, listing, "all");

      const box = await plankBox(t);
      expect(box.image).toBe(await urlOf(t, image));
      expect(box.thumbUrl).toBe(await urlOf(t, small!));
    },
  );

  test.each(NOT_SERVED)(
    "box art the gate withholds has no image and no thumbUrl, even with renditions: %s",
    async (_n, listing) => {
      const t = convexTest(schema, modules);
      await seed(t, listing, "all");

      const box = await plankBox(t);
      expect(box.image).toBeNull();
      expect(box).not.toHaveProperty("thumbUrl");
    },
  );

  test("before the backfill the plank box carries the original only", async () => {
    const t = convexTest(schema, modules);
    const { image } = await seed(t, null, "none");

    const box = await plankBox(t);
    expect(box).toEqual({
      title: "Mountain Vista",
      pieceCount: 1000,
      image: await urlOf(t, image),
    });
  });

  test("the response carries URLs only, never a source or rendition storage id", async () => {
    const t = convexTest(schema, modules);
    const { image, small, medium, large } = await seed(t, null, "all");

    const raw = JSON.stringify(
      await t.query(api.insights.getPlankPuzzles.getPlankPuzzles, {
        limit: 12,
        seed: 1,
      }),
    );
    expect(raw).toContain("thumbUrl");
    for (const id of [image, small!, medium!, large!]) {
      expect(raw).not.toContain(id);
    }
  });
});
