import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-01 (P-01 Phase A): no read hands a member a raw `_storage` id they did not upload
// themselves. A box-art id in a response was the first step of the box-art wipe: attach the id
// as a photo, then delete the photo. Each read below is checked against EVERY stored blob, so a
// new field that starts carrying an id fails here too. Images reach the client as URLs
// (coverUrl, photoItems, definitionImage, ...); convex-test builds those from the blob's sha256,
// never from its id.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const store = (t: T) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([crypto.randomUUID()], { type: "image/png" }),
      ) as Promise<Id<"_storage">>,
  );

const allBlobs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_storage").collect()).map((b) => b._id),
  );

// The stored blobs whose id appears anywhere in `value`.
const idsIn = (value: unknown, blobs: readonly Id<"_storage">[]) => {
  const json = JSON.stringify(value) ?? "";
  return blobs.filter((id) => json.includes(id));
};

const OPEN = { forTrade: true, forSale: false, forLend: false };

// Alice owns a copy of puzzle P (box art `boxArt`) with an approved photo, a pending photo, a
// finished completion with a photo, a public collection, a featured shelf and a pending image
// proposal for P (her own upload `proposedArt`). Bob owns a copy of P too and asks Alice to
// trade. An admin reviews proposals.
const seed = async (t: T) => {
  const boxArt = await store(t);
  const proposedArt = await store(t);
  const photo = await store(t);
  const pendingPhoto = await store(t);
  const completionPhoto = await store(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (who: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    await mkUser("admin");

    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      image: boxArt,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    // Every copy caches the box-art id as its snapshot thumbnail (catalog snapshot provider).
    const snapshot = {
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      thumbnail: boxArt as string,
    };
    const mkCopy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId: crypto.randomUUID(),
        puzzleDefinitionId: definitionId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: OPEN,
        visibility: "visible",
        visibilityAuthoritative: true,
        snapshot,
        createdAt: now,
        updatedAt: now,
      });
    const copy = await mkCopy(alice);
    const bobCopy = await mkCopy(bob);

    const photoRow = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId: photo,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId: pendingPhoto,
      moderationStatus: "pending",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await ctx.db.patch(copy, { coverImageId: photoRow });

    const completionId = crypto.randomUUID();
    await ctx.db.insert("completions", {
      aggregateId: completionId,
      userId: alice,
      puzzleId,
      ownedPuzzleId: copy,
      startDate: now - 60_000,
      endDate: now,
      photos: [completionPhoto],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completionImages", {
      completionId,
      uploaderId: alice,
      fileId: completionPhoto,
      moderationStatus: "approved",
      createdAt: now,
      updatedAt: now,
    });

    const collection = await ctx.db.insert("collections", {
      aggregateId: crypto.randomUUID(),
      userId: alice,
      name: "Favourites",
      visibility: "public",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("collectionMembers", {
      collectionId: collection,
      ownedPuzzleId: copy,
      addedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: alice,
      displayName: "alice",
      visibility: "public",
      featuredCopyIds: [copy],
      updatedAt: now,
    });

    const exchange = await ctx.db.insert("exchanges", {
      aggregateId: crypto.randomUUID(),
      initiatorId: bob,
      recipientId: alice,
      type: "trade",
      offeredPuzzleId: bobCopy,
      requestedPuzzleId: copy,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("boxArtUploads", {
      storageId: proposedArt,
      uploaderId: alice,
      moderationStatus: "approved",
      createdAt: now,
    });
    const proposalId = crypto.randomUUID();
    await ctx.db.insert("puzzleChangeProposals", {
      aggregateId: proposalId,
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      status: "pending",
      changes: { image: proposedArt as string },
      baseline: { image: boxArt as string },
      createdAt: now,
      updatedAt: now,
    });

    return {
      alice,
      bob,
      definitionId,
      puzzleId,
      copy,
      collection,
      exchange,
      proposalId,
    };
  });
  return { ...ids, boxArt, proposedArt, photo, pendingPhoto, completionPhoto };
};

type Seeded = Awaited<ReturnType<typeof seed>>;

const as = (t: T, who: "alice" | "bob") =>
  t.withIdentity({ subject: `clerk_${who}` });

const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

// The reads that show a copy to its owner or to another member.
const copyReads = (t: T, s: Seeded, who: "alice" | "bob") => {
  const viewer = as(t, who);
  return {
    ownedByOwner: viewer.query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: s.alice, includeUnavailable: true },
    ),
    browseOwned: viewer.query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      { includeOwnPuzzles: true },
    ),
    featuredShelf: viewer.query(api.social.featuredShelf.featuredShelf, {
      userId: s.alice,
    }),
    collection: viewer.query(api.library.getCollectionById.getCollectionById, {
      collectionId: s.collection,
    }),
    profileCopies: viewer.query(
      api.social.listProfileCopies.listProfileCopies,
      {
        memberId: s.alice,
        paginationOpts: { numItems: 20, cursor: null },
      },
    ),
    publicProfile: viewer.query(api.social.getPublicProfile.getPublicProfile, {
      handle: s.alice,
    }),
    exchanges: viewer.query(api.exchange.getUserExchanges.getUserExchanges, {}),
    exchangeById: viewer.query(api.exchange.getExchangeById.getExchangeById, {
      exchangeId: s.exchange,
    }),
  };
};

describe("no raw storage ids in read responses", () => {
  test("copy and exchange reads carry no storage id, to the owner or anyone else", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);

    for (const who of ["alice", "bob"] as const) {
      for (const [name, read] of Object.entries(copyReads(t, s, who))) {
        const result = await read;
        // Each read really returns the copy (so an empty answer can't pass vacuously).
        expect(JSON.stringify(result), `${who} ${name}`).toContain(
          "Mountain Vista",
        );
        expect(idsIn(result, blobs), `${who} ${name}`).toEqual([]);
      }
    }
  });

  test("the owner's copy management read gives photo URLs, never storage ids", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);

    const view = await as(t, "alice").query(
      api.library.getOwnedPuzzleWithCollectionStatus
        .getOwnedPuzzleWithCollectionStatus,
      { ownedPuzzleId: s.copy },
    );

    expect(idsIn(view, blobs)).toEqual([]);
    // The approved photo is served; the pending one is listed without a URL.
    expect(view?.images.map((image) => typeof image.url)).toEqual([
      "string",
      "object",
    ]);
    expect(view?.images[1].url).toBeNull();
    expect(view?.completionHistory).toHaveLength(1);
  });

  test("a member's own completion reads give photo URLs, never storage ids", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);
    const alice = as(t, "alice");

    const mine = await alice.query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    const history = await alice.query(
      api.solving.getCompletionHistory.getCompletionHistory,
      { puzzleDefinitionId: s.definitionId },
    );

    for (const rows of [mine, history]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].photoItems).toEqual([
        { url: expect.stringMatching(/^https:/), pending: false },
      ]);
      expect(idsIn(rows, blobs)).toEqual([]);
    }
  });

  test("a proposer sees only their own upload; baseline and current images are URLs", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);

    const [proposal] = await as(t, "alice").query(
      api.catalog.listMyChangeProposals.listMyChangeProposals,
      {},
    );

    // `changes.image` is the proposer's own upload: the edit form restates it on re-edit.
    expect(idsIn(proposal, blobs)).toEqual([s.proposedArt]);
    expect(proposal.changes.image).toBe(s.proposedArt);
    expect(proposal.baseline.image).toMatch(/^https:/);
    expect(proposal.current.image).toBe(proposal.definitionImage);
    expect(proposal.conflictFields).toEqual([]);
  });

  test("the admin proposal reads carry no catalogue box-art id", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);
    const admin = asAdmin(t);

    const reads = {
      pending: await admin.query(
        api.catalog.listPendingChangeProposals.listPendingChangeProposals,
        {},
      ),
      forDefinition: await admin.query(
        api.catalog.listProposalsForDefinition.listProposalsForDefinition,
        { puzzleDefinitionId: s.definitionId },
      ),
      byId: await admin.query(api.catalog.getChangeProposal.getChangeProposal, {
        changeProposalId: s.proposalId,
      }),
    };
    for (const [name, result] of Object.entries(reads)) {
      // Only the proposed upload under review, never the definition's current or baseline art.
      expect(idsIn(result, blobs), name).toEqual([s.proposedArt]);
    }
  });

  test("a conflict on the image is still detected after the art changed", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // The definition's art was replaced since the proposal was filed, and the old blob is gone.
    const newArt = await store(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(s.puzzleId, { image: newArt });
      await ctx.storage.delete(s.boxArt);
    });
    const blobs = await allBlobs(t);

    const proposal = await asAdmin(t).query(
      api.catalog.getChangeProposal.getChangeProposal,
      { changeProposalId: s.proposalId },
    );

    expect(proposal?.conflictFields).toEqual(["image"]);
    expect(proposal?.hasConflict).toBe(true);
    // The baseline art no longer resolves, so it is left out rather than sent as an id.
    expect(proposal?.baseline.image).toBeUndefined();
    expect(proposal?.current.image).toMatch(/^https:/);
    expect(idsIn(proposal, [...blobs, s.boxArt])).toEqual([s.proposedArt]);
  });

  test("the data export carries no box-art or copy-photo id", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const blobs = await allBlobs(t);

    const exported = await as(t, "alice").query(
      api.insights.exportUserData.exportUserData,
      {},
    );

    expect(exported.ownedPuzzles[0].snapshot).toEqual({
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
    });
    // Only the member's own completion photos may still appear (as ids, until SEC-66 exports
    // them as files); never catalogue art or copy photos.
    expect(
      idsIn(exported, blobs).filter((id) => id !== s.completionPhoto),
    ).toEqual([]);
  });
});
