import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Box-art renditions on the signed-in surfaces (PERF-C1, P-42). The catalogue summary cards carry
// an `imageSrcSet` and the owned-copy cards a `coverSrcSet` (480 w, 960 w and the original), so
// the browser picks a width. Both are given only for box art the publication gate (boxArtUrl)
// serves, only as URLs, and only once renditions exist; before the backfill every read is exactly
// what it was. An approved cover photo has no renditions (yet), so its card shows it alone.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Listing = Partial<
  Pick<
    Doc<"boxArtUploads">,
    "moderationStatus" | "hashCheckedAt" | "hashCheckPendingSince"
  >
>;

const EAN = "4005556123456";

type Seeded = {
  alice: Id<"users">;
  bob: Id<"users">;
  puzzleId: Id<"puzzles">;
  copyId: Id<"ownedPuzzles">;
  image: Id<"_storage">;
  small?: Id<"_storage">;
  medium?: Id<"_storage">;
};

// Alice and Bob; one approved definition whose box art is listed with `listing` (null: not
// listed, legacy) and, when `renditions`, has a 480 and a 960 rendition of a 1600 px source; and
// one open copy of it that Alice owns.
const seed = (t: T, listing: Listing | null, renditions: boolean) =>
  t.run(async (ctx): Promise<Seeded> => {
    const now = Date.now();
    const user = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await user("alice");
    const bob = await user("bob");
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
    const aggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "mountain vista ravensburger",
      ean: EAN,
      status: "approved",
      submittedBy: alice,
      image,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: aggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    if (!renditions) return { alice, bob, puzzleId, copyId, image };
    const webp = (body: string) =>
      ctx.storage.store(new Blob([body], { type: "image/webp" }));
    const small = await webp("small rendition");
    const medium = await webp("medium rendition");
    await ctx.db.insert("imageRenditions", {
      sourceId: image,
      width: 1600,
      height: 1200,
      small: { fileId: small, width: 480, height: 360 },
      medium: { fileId: medium, width: 960, height: 720 },
      createdAt: now,
    });
    return { alice, bob, puzzleId, copyId, image, small, medium };
  });

const urlOf = async (t: T, id: Id<"_storage"> | undefined) => {
  if (!id) throw new Error("no blob");
  const url = await t.run((ctx) => ctx.storage.getUrl(id));
  if (!url) throw new Error("blob has no URL");
  return url;
};

// The srcset the seeded renditions make: both renditions, then the original at its own width.
const srcSetOf = async (t: T, s: Seeded) =>
  `${await urlOf(t, s.small)} 480w, ${await urlOf(t, s.medium)} 960w, ${await urlOf(t, s.image)} 1600w`;

const asAlice = (t: T) => t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: T) => t.withIdentity({ subject: "clerk_bob" });

const SERVED = { label: "not listed (legacy)", listing: null } as const;
const WITHHELD = {
  label: "rejected",
  listing: { moderationStatus: "rejected", hashCheckedAt: 1 },
} as const;

// Neither a source nor a rendition storage id may cross the wire.
const expectNoStorageIds = (response: unknown, s: Seeded) => {
  const json = JSON.stringify(response);
  for (const id of [s.image, s.small, s.medium]) {
    if (id) expect(json).not.toContain(id);
  }
};

// ---------------------------------------------------------------------------------------------
// Catalogue summary cards (toPuzzleSummaryView): imageSrcSet next to the original `image`.
// ---------------------------------------------------------------------------------------------

type SummaryRead = (
  t: T,
  s: Seeded,
) => Promise<{
  card: { image?: string | null; imageSrcSet?: string };
  response: unknown;
}>;

const one = <V>(rows: V[]): V => {
  expect(rows).toHaveLength(1);
  return rows[0];
};

const SUMMARY_READS: [string, SummaryRead][] = [
  [
    "catalog.listAllPuzzles",
    async (t) => {
      const response = await t.query(
        api.catalog.listAllPuzzles.listAllPuzzles,
        {
          paginationOpts: { numItems: 10, cursor: null },
        },
      );
      return { card: one(response.page), response };
    },
  ],
  [
    "catalog.getRecentPuzzles",
    async (t) => {
      const response = await t.query(
        api.catalog.getRecentPuzzles.getRecentPuzzles,
        {},
      );
      return { card: one(response), response };
    },
  ],
  [
    "catalog.listMyFavorites",
    async (t, s) => {
      await t.run((ctx) =>
        ctx.db.insert("favorites", {
          userId: s.alice,
          puzzleId: s.puzzleId,
          createdAt: Date.now(),
        }),
      );
      const response = await asAlice(t).query(
        api.catalog.listMyFavorites.listMyFavorites,
        {},
      );
      return { card: one(response), response };
    },
  ],
  [
    "catalog.searchCatalog (browse)",
    async (t) => {
      const response = await asAlice(t).query(
        api.catalog.searchCatalog.searchCatalog,
        { paginationOpts: { numItems: 10, cursor: null } },
      );
      return { card: one(response.page), response };
    },
  ],
  [
    "catalog.searchCatalog (term)",
    async (t) => {
      const response = await asAlice(t).query(
        api.catalog.searchCatalog.searchCatalog,
        { paginationOpts: { numItems: 10, cursor: null }, searchTerm: "vista" },
      );
      return { card: one(response.page), response };
    },
  ],
  [
    "catalog.getPuzzleSuggestions",
    async (t) => {
      const response = await t.query(
        api.catalog.getPuzzleSuggestions.getPuzzleSuggestions,
        { searchTerm: "vista" },
      );
      return { card: one(response), response };
    },
  ],
  [
    "catalog.lookupPuzzleByBarcode",
    async (t) => {
      const response = await asAlice(t).query(
        api.catalog.findPuzzleByBarcode.lookupPuzzleByBarcode,
        { code: EAN },
      );
      if (!response) throw new Error("no barcode match");
      return { card: response, response };
    },
  ],
];

describe("catalogue summary cards: imageSrcSet", () => {
  test.each(SUMMARY_READS)(
    "%s: served box art with renditions",
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, SERVED.listing, true);
      const { card, response } = await read(t, s);
      expect(card.image).toBe(await urlOf(t, s.image));
      expect(card.imageSrcSet).toBe(await srcSetOf(t, s));
      expectNoStorageIds(response, s);
    },
  );

  test.each(SUMMARY_READS)(
    `%s: ${WITHHELD.label} box art with a leftover renditions row`,
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, WITHHELD.listing, true);
      const { card, response } = await read(t, s);
      expect(card.image).toBeNull();
      expect(card).not.toHaveProperty("imageSrcSet");
      expectNoStorageIds(response, s);
    },
  );

  test.each(SUMMARY_READS)(
    "%s: before the backfill, the original alone",
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, SERVED.listing, false);
      const { card } = await read(t, s);
      expect(card.image).toBe(await urlOf(t, s.image));
      expect(card).not.toHaveProperty("imageSrcSet");
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Owned-copy cards (toOwnedCopyView): coverSrcSet next to coverUrl, on every read a card grid
// renders.
// ---------------------------------------------------------------------------------------------

type CopyCard = { coverUrl?: string | null; coverSrcSet?: string };
type CopyRead = (
  t: T,
  s: Seeded,
) => Promise<{ card: CopyCard; response: unknown }>;

const COPY_CARD_READS: [string, CopyRead][] = [
  [
    "library.getOwnedPuzzlesByOwner",
    async (t, s) => {
      const response = await asAlice(t).query(
        api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
        { ownerId: s.alice, includeUnavailable: true },
      );
      return { card: one(response), response };
    },
  ],
  [
    "library.browseOwnedPuzzles",
    async (t) => {
      const response = await asBob(t).query(
        api.library.browseOwnedPuzzles.browseOwnedPuzzles,
        {},
      );
      return { card: one(response.ownedPuzzles), response };
    },
  ],
  [
    "library.getCollectionById",
    async (t, s) => {
      const collectionId = await t.run(async (ctx) => {
        const now = Date.now();
        const id = await ctx.db.insert("collections", {
          userId: s.alice,
          name: "Favourites",
          visibility: "private",
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("collectionMembers", {
          collectionId: id,
          ownedPuzzleId: s.copyId,
          addedAt: now,
        });
        return id;
      });
      const response = await asAlice(t).query(
        api.library.getCollectionById.getCollectionById,
        { collectionId },
      );
      if (!response) throw new Error("no collection");
      return { card: one(response.puzzles), response };
    },
  ],
  [
    "household.listHouseholdCopies",
    async (t, s) => {
      await t.run(async (ctx) => {
        const householdId = crypto.randomUUID();
        await ctx.db.insert("households", {
          aggregateId: householdId,
          createdAt: Date.now(),
        });
        for (const memberId of [s.alice, s.bob]) {
          await ctx.db.insert("householdMembers", {
            householdId,
            memberId,
            role: "member",
            joinedAt: Date.now(),
          });
        }
      });
      const response = await asBob(t).query(
        api.household.listHouseholdCopies.listHouseholdCopies,
        {},
      );
      return { card: one(response), response };
    },
  ],
  [
    "social.listProfileCopies",
    async (t, s) => {
      const response = await asBob(t).query(
        api.social.listProfileCopies.listProfileCopies,
        { memberId: s.alice, paginationOpts: { numItems: 10, cursor: null } },
      );
      return { card: one(response.page), response };
    },
  ],
];

// Alice's approved cover photo on the seeded copy.
const setCoverPhoto = (t: T, s: Seeded) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const fileId = await ctx.storage.store(
      new Blob(["cover photo"], { type: "image/jpeg" }),
    );
    const photoId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: s.copyId,
      uploaderId: s.alice,
      fileId,
      moderationStatus: "approved",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(s.copyId, { coverImageId: photoId });
    const url = await ctx.storage.getUrl(fileId);
    if (!url) throw new Error("cover photo has no URL");
    return url;
  });

describe("owned-copy cards: coverSrcSet", () => {
  test.each(COPY_CARD_READS)(
    "%s: served box art with renditions",
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, SERVED.listing, true);
      const { card, response } = await read(t, s);
      expect(card.coverSrcSet).toBe(await srcSetOf(t, s));
      expect(card.coverUrl).toBe(await urlOf(t, s.image));
      expectNoStorageIds(response, s);
    },
  );

  test.each(COPY_CARD_READS)(
    `%s: ${WITHHELD.label} box art with a leftover renditions row`,
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, WITHHELD.listing, true);
      const { card, response } = await read(t, s);
      expect(card.coverUrl).toBeNull();
      expect(card.coverSrcSet).toBeUndefined();
      expectNoStorageIds(response, s);
    },
  );

  test.each(COPY_CARD_READS)(
    "%s: before the backfill, the original alone",
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, SERVED.listing, false);
      const { card } = await read(t, s);
      expect(card.coverUrl).toBe(await urlOf(t, s.image));
      expect(card.coverSrcSet).toBeUndefined();
    },
  );

  test.each(COPY_CARD_READS)(
    "%s: an approved cover photo wins and is shown alone",
    async (_n, read) => {
      const t = convexTest(schema, modules);
      const s = await seed(t, SERVED.listing, true);
      const photoUrl = await setCoverPhoto(t, s);
      const { card } = await read(t, s);
      expect(card.coverUrl).toBe(photoUrl);
      expect(card.coverSrcSet).toBeUndefined();
    },
  );
});
