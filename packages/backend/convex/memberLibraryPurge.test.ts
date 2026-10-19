import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Account deletion beyond messaging (spec 2026-10-19 deleted member ghost): users.deleteUser
// schedules conversation/purgeMemberMessagingData, whose later phases settle the member's open
// trades and loans, delete their library, photos, completions, goals, collections and categories,
// hand their circles over and take them out of their household. A copy they gave away is never
// touched: its History stays and shows them as a departed member.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The purge's presence phase (before the phases under test) needs the component.
const newT = (): T => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const settleDueJobs = async (t: T) => {
  for (let i = 0; i < 400; i++) {
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

const deleteMember = async (t: T, who: Who) => {
  await t.mutation(internal.users.deleteUser, { id: `clerk_${who}` });
  await settleDueJobs(t);
};

const CLOSED = { forTrade: false, forSale: false, forLend: false };
const FOR_SALE = { forTrade: false, forSale: true, forLend: false };

// Four members and one catalogue puzzle.
const seedMembers = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        username: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mk("alice");
    const bob = await mk("bob");
    const carol = await mk("carol");
    const dave = await mk("dave");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Lighthouse",
      pieceCount: 1000,
      status: "approved",
      submittedBy: carol,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, carol, dave, puzzleId };
  });

let copySeq = 0;
const insertCopy = (
  t: T,
  puzzleId: Id<"puzzles">,
  ownerId: Id<"users">,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run(async (ctx) => {
    copySeq += 1;
    const now = Date.now();
    return ctx.db.insert("ownedPuzzles", {
      aggregateId: `copy-${copySeq}`,
      puzzleId,
      ownerId,
      condition: "good",
      availability: CLOSED,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
  });

const aggregateIdOf = async (t: T, copyId: Id<"ownedPuzzles">) =>
  (await t.run((ctx) => ctx.db.get(copyId)))!.aggregateId!;

describe("account deletion: open exchanges", () => {
  const insertExchange = (
    t: T,
    row: Pick<
      Doc<"exchanges">,
      "initiatorId" | "recipientId" | "requestedPuzzleId" | "status"
    >,
  ) =>
    t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("exchanges", {
        type: "sale",
        salePrice: { amount: 10, currency: "EUR" },
        createdAt: now,
        updatedAt: now,
        ...row,
      });
    });

  test("her proposed and accepted exchanges, both sides, are cancelled; settled ones stay", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const aliceCopy = await insertCopy(t, s.puzzleId, s.alice, {
      availability: FOR_SALE,
    });
    const bobCopy = await insertCopy(t, s.puzzleId, s.bob, {
      availability: FOR_SALE,
    });
    const proposedToHer = await insertExchange(t, {
      initiatorId: s.bob,
      recipientId: s.alice,
      requestedPuzzleId: aliceCopy,
      status: "proposed",
    });
    const acceptedByBob = await insertExchange(t, {
      initiatorId: s.alice,
      recipientId: s.bob,
      requestedPuzzleId: bobCopy,
      status: "accepted",
    });
    const completed = await insertExchange(t, {
      initiatorId: s.carol,
      recipientId: s.alice,
      requestedPuzzleId: aliceCopy,
      status: "completed",
    });
    const rejected = await insertExchange(t, {
      initiatorId: s.alice,
      recipientId: s.carol,
      requestedPuzzleId: bobCopy,
      status: "rejected",
    });
    const disputed = await insertExchange(t, {
      initiatorId: s.bob,
      recipientId: s.alice,
      requestedPuzzleId: aliceCopy,
      status: "disputed",
    });
    const others = await insertExchange(t, {
      initiatorId: s.carol,
      recipientId: s.bob,
      requestedPuzzleId: bobCopy,
      status: "proposed",
    });

    await deleteMember(t, "alice");

    const status = (id: Id<"exchanges">) =>
      t.run(async (ctx) => (await ctx.db.get(id))?.status);
    expect(await status(proposedToHer)).toBe("cancelled");
    expect(await status(acceptedByBob)).toBe("cancelled");
    expect(await status(completed)).toBe("completed");
    expect(await status(rejected)).toBe("rejected");
    expect(await status(disputed)).toBe("disputed");
    expect(await status(others)).toBe("proposed");
  });
});

describe("account deletion: open loans", () => {
  const insertLoan = (
    t: T,
    row: Pick<Doc<"loans">, "copyId" | "lenderId" | "borrowerId" | "status">,
  ) =>
    t.run(async (ctx) =>
      ctx.db.insert("loans", {
        aggregateId: `loan-${row.copyId}-${row.status}`,
        openedAt: Date.now() - 1000,
        ...(row.status !== "open" && { closedAt: Date.now() - 500 }),
        ...row,
      }),
    );

  test("loans she lent or borrowed are returned and the copy is back with its owner", async () => {
    const t = newT();
    const s = await seedMembers(t);
    // Bob borrows Alice's copy; Alice borrows Carol's copy.
    const lentByHer = await insertCopy(t, s.puzzleId, s.alice, {
      heldBy: s.bob,
    });
    const borrowedByHer = await insertCopy(t, s.puzzleId, s.carol, {
      heldBy: s.alice,
    });
    const lent = await insertLoan(t, {
      copyId: await aggregateIdOf(t, lentByHer),
      lenderId: s.alice,
      borrowerId: s.bob,
      status: "open",
    });
    const borrowed = await insertLoan(t, {
      copyId: await aggregateIdOf(t, borrowedByHer),
      lenderId: s.carol,
      borrowerId: s.alice,
      status: "open",
    });
    const earlier = await insertLoan(t, {
      copyId: await aggregateIdOf(t, borrowedByHer),
      lenderId: s.carol,
      borrowerId: s.alice,
      status: "recalled",
    });
    const earlierBefore = await t.run((ctx) => ctx.db.get(earlier));

    await deleteMember(t, "alice");

    const loans = await t.run(async (ctx) => ({
      lent: await ctx.db.get(lent),
      borrowed: await ctx.db.get(borrowed),
      earlier: await ctx.db.get(earlier),
    }));
    for (const loan of [loans.lent, loans.borrowed]) {
      expect(loan?.status).toBe("returned");
      expect(loan?.closedAt).toEqual(expect.any(Number));
    }
    expect(loans.earlier).toEqual(earlierBefore);
    // Carol's copy is hers again, in her hands.
    const carolCopy = await t.run((ctx) => ctx.db.get(borrowedByHer));
    expect(carolCopy?.ownerId).toBe(s.carol);
    expect(carolCopy?.heldBy).toBeUndefined();
  });
});

// A stored blob, standing in for an uploaded photo.
const storeBlob = (t: T) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob(["photo"], { type: "image/jpeg" })),
  );

const blobExists = (t: T, fileId: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(fileId)) !== null);

const insertPhoto = async (
  t: T,
  ownedPuzzleId: Id<"ownedPuzzles">,
  uploaderId: Id<"users">,
  extra: Partial<Doc<"ownedPuzzleImages">> = {},
) => {
  const fileId = await storeBlob(t);
  const imageId = await t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId,
      uploaderId,
      fileId,
      moderationStatus: "approved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra,
    }),
  );
  return { imageId, fileId };
};

let completionSeq = 0;
// A finished completion with one photo (row `photos` + its completionImages sidecar).
const insertCompletion = async (
  t: T,
  userId: Id<"users">,
  ownedPuzzleId: Id<"ownedPuzzles"> | undefined,
) => {
  completionSeq += 1;
  const aggregateId = `completion-${completionSeq}`;
  const fileId = await storeBlob(t);
  const completionId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("completions", {
      aggregateId,
      userId,
      ownedPuzzleId,
      startDate: now - 3_600_000,
      endDate: now - 60_000,
      photos: [fileId],
      isCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completionImages", {
      completionId: aggregateId,
      uploaderId: userId,
      fileId,
      moderationStatus: "approved",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  return { completionId, aggregateId, fileId };
};

const completionImagesOf = (t: T, aggregateId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", aggregateId))
      .collect(),
  );

// Bob buys `copy` from Alice through the real exchange path (propose, accept, both confirm), so
// the settlement subscribers move the copy and record the custody entry.
const sellToBob = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  alice: Id<"users">,
) => {
  const exchangeId = await as(t, "bob").mutation(api.exchange.propose.propose, {
    recipientId: alice,
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });
  await as(t, "alice").mutation(api.exchange.accept.accept, { exchangeId });
  await as(t, "bob").mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId },
  );
  await as(t, "alice").mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId },
  );
  await settleDueJobs(t);
  return exchangeId;
};

// propose returns the exchange's aggregateId; the read views take the row _id.
const exchangeRowId = async (t: T, aggregateId: string) =>
  (await t.run((ctx) =>
    ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  ))!._id;

const DEPARTED = { anonymous: true, departed: true };

describe("account deletion: a copy she sold stays whole; her own library goes", () => {
  // Alice sells one copy to Bob, after solving it (a completion with a photo), lending it to Carol
  // and adding a photo of it. She keeps another copy, with photos, a collection, a copy review, a
  // circle share and a copy note, and Bob's own solve of it while he borrowed it.
  const seed = async (t: T) => {
    const s = await seedMembers(t);
    const sold = await insertCopy(t, s.puzzleId, s.alice, {
      availability: FOR_SALE,
    });
    const soldAggregateId = await aggregateIdOf(t, sold);
    const herSolveOfSold = await insertCompletion(t, s.alice, sold);
    await t.run((ctx) =>
      ctx.db.insert("loans", {
        aggregateId: "loan-history",
        copyId: soldAggregateId,
        lenderId: s.alice,
        borrowerId: s.carol,
        status: "returned",
        openedAt: Date.now() - 10_000,
        closedAt: Date.now() - 5_000,
      }),
    );
    const herPhotoOfSold = await insertPhoto(t, sold, s.alice);
    const exchangeId = await sellToBob(t, sold, s.alice);

    const own = await insertCopy(t, s.puzzleId, s.alice, {
      availability: FOR_SALE,
    });
    const ownAggregateId = await aggregateIdOf(t, own);
    const ownPhoto = await insertPhoto(t, own, s.alice);
    const ownCover = await insertPhoto(t, own, s.alice);
    await t.run((ctx) => ctx.db.patch(own, { coverImageId: ownCover.imageId }));
    const herSolveOfOwn = await insertCompletion(t, s.alice, own);
    const bobsSolveOfOwn = await insertCompletion(t, s.bob, own);
    await t.run(async (ctx) => {
      const now = Date.now();
      const collectionId = await ctx.db.insert("collections", {
        userId: s.alice,
        name: "Favourites",
        visibility: "private",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("collectionMembers", {
        collectionId,
        ownedPuzzleId: own,
        addedAt: now,
      });
      await ctx.db.insert("copyReviews", {
        userId: s.bob,
        copyId: own,
        rating: 4,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("circleCopyShares", {
        circleId: "circle-x",
        copyId: ownAggregateId,
        sharedAt: now,
      });
      await ctx.db.insert("puzzleComments", {
        puzzleId: s.puzzleId,
        copyId: own,
        authorId: s.alice,
        text: "Missing one edge piece",
        createdAt: now,
      });
      await ctx.db.insert("photoComments", {
        photoId: ownPhoto.imageId,
        authorId: s.bob,
        text: "Nice",
        createdAt: now,
      });
    });
    return {
      ...s,
      sold,
      exchangeId,
      herSolveOfSold,
      herPhotoOfSold,
      own,
      ownPhoto,
      ownCover,
      herSolveOfOwn,
      bobsSolveOfOwn,
    };
  };

  test("the sale went through the real settlement path", async () => {
    const t = newT();
    const s = await seed(t);
    const copy = await t.run((ctx) => ctx.db.get(s.sold));
    expect(copy?.ownerId).toBe(s.bob);
    const custody = await t.run((ctx) =>
      ctx.db
        .query("copyCustodyEntries")
        .withIndex("by_copy", (q) => q.eq("copyId", s.sold as string))
        .collect(),
    );
    expect(custody.map((e) => [e.previousOwner, e.newOwner])).toEqual([
      [s.alice, s.bob],
    ]);
  });

  test("Bob keeps the copy she sold him, with its full History naming her as departed", async () => {
    const t = newT();
    const s = await seed(t);
    await deleteMember(t, "alice");

    const copy = await t.run((ctx) => ctx.db.get(s.sold));
    expect(copy?.ownerId).toBe(s.bob);

    const view = await as(t, "bob").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s.sold },
    );
    expect(view).not.toBeNull();
    expect(view!.transfers).toHaveLength(1);
    expect(view!.transfers[0].from).toMatchObject(DEPARTED);
    expect(view!.transfers[0].from).not.toHaveProperty("member");
    expect(view!.completions).toHaveLength(1);
    expect(view!.completions[0].solver).toMatchObject(DEPARTED);
    expect(view!.loans).toHaveLength(1);
    expect(view!.loans[0].lender).toMatchObject(DEPARTED);
    expect(view!.loans[0].borrower).toMatchObject({ anonymous: false });
    // Her photo of it is gone.
    expect(view!.gallery).toEqual([]);

    const timeline = await as(t, "bob").query(
      api.custody.getCopyCustodyTimeline.getCopyCustodyTimeline,
      { copyId: s.sold },
    );
    expect(timeline!.originalOwner).toMatchObject(DEPARTED);
    expect(timeline!.originalOwner).not.toHaveProperty("member");
    expect(timeline!.transfers).toHaveLength(1);
    expect(timeline!.currentOwner).toMatchObject({ anonymous: false });

    // The settled trade still opens for Bob.
    const exchange = await as(t, "bob").query(
      api.exchange.getExchangeById.getExchangeById,
      { exchangeId: await exchangeRowId(t, s.exchangeId) },
    );
    expect(exchange?.status).toBe("completed");
  });

  test("her solve of the sold copy stays without its photos; her photo of it is deleted", async () => {
    const t = newT();
    const s = await seed(t);
    await deleteMember(t, "alice");

    const solve = await t.run((ctx) =>
      ctx.db.get(s.herSolveOfSold.completionId),
    );
    expect(solve).not.toBeNull();
    expect(solve!.photos).toEqual([]);
    expect(await completionImagesOf(t, s.herSolveOfSold.aggregateId)).toEqual(
      [],
    );
    expect(await blobExists(t, s.herSolveOfSold.fileId)).toBe(false);

    expect(
      await t.run((ctx) => ctx.db.get(s.herPhotoOfSold.imageId)),
    ).toBeNull();
    expect(await blobExists(t, s.herPhotoOfSold.fileId)).toBe(false);
  });

  test("her own copy goes with its photos, blobs, links and her solve; Bob's solve stays", async () => {
    const t = newT();
    const s = await seed(t);
    await deleteMember(t, "alice");

    const left = await t.run(async (ctx) => ({
      copy: await ctx.db.get(s.own),
      images: await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", s.own))
        .collect(),
      memberships: await ctx.db
        .query("collectionMembers")
        .withIndex("by_owned_puzzle", (q) => q.eq("ownedPuzzleId", s.own))
        .collect(),
      reviews: await ctx.db
        .query("copyReviews")
        .withIndex("by_copy", (q) => q.eq("copyId", s.own))
        .collect(),
      shares: await ctx.db.query("circleCopyShares").collect(),
      notes: await ctx.db
        .query("puzzleComments")
        .withIndex("by_copy", (q) => q.eq("copyId", s.own))
        .collect(),
      photoComments: await ctx.db.query("photoComments").collect(),
      herSolve: await ctx.db.get(s.herSolveOfOwn.completionId),
      bobsSolve: await ctx.db.get(s.bobsSolveOfOwn.completionId),
    }));
    expect(left).toMatchObject({
      copy: null,
      images: [],
      memberships: [],
      reviews: [],
      shares: [],
      notes: [],
      photoComments: [],
      herSolve: null,
    });
    expect(left.bobsSolve?.photos).toHaveLength(1);
    for (const fileId of [
      s.ownPhoto.fileId,
      s.ownCover.fileId,
      s.herSolveOfOwn.fileId,
    ]) {
      expect(await blobExists(t, fileId)).toBe(false);
    }
    expect(await blobExists(t, s.bobsSolveOfOwn.fileId)).toBe(true);
  });

  test("Browse lists her copy before and not after", async () => {
    const t = newT();
    const s = await seed(t);
    const browse = async () =>
      (
        await as(t, "carol").query(
          api.library.browseOwnedPuzzles.browseOwnedPuzzles,
          {},
        )
      ).ownedPuzzles.map((c) => c._id);
    expect(await browse()).toContain(s.own);

    await deleteMember(t, "alice");

    expect(await browse()).not.toContain(s.own);
  });

  test("an exchange about her deleted copy still opens for Bob, cancelled", async () => {
    const t = newT();
    const s = await seed(t);
    const exchangeId = await as(t, "bob").mutation(
      api.exchange.propose.propose,
      {
        recipientId: s.alice,
        type: "sale",
        requestedPuzzleId: s.own,
        salePrice: 900,
      },
    );
    await deleteMember(t, "alice");

    const view = await as(t, "bob").query(
      api.exchange.getExchangeById.getExchangeById,
      { exchangeId: await exchangeRowId(t, exchangeId) },
    );
    expect(view?.status).toBe("cancelled");
    expect(view?.ownerPuzzle).toBeNull();
    const list = await as(t, "bob").query(
      api.exchange.getUserExchanges.getUserExchanges,
      {},
    );
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("account deletion: photos kept for a CSAM escalation", () => {
  test("a quarantined copy photo and a preserved blob stay; the rest goes", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const bobsCopy = await insertCopy(t, s.puzzleId, s.bob);
    const own = await insertCopy(t, s.puzzleId, s.alice);
    const quarantined = await insertPhoto(t, bobsCopy, s.alice, {
      moderationStatus: "quarantined",
    });
    const quarantinedOnOwn = await insertPhoto(t, own, s.alice, {
      moderationStatus: "quarantined",
    });
    const plain = await insertPhoto(t, bobsCopy, s.alice);
    // A plain row whose blob an escalation preserves (the same file re-uploaded). The open
    // escalation also tombstones Alice instead of deleting her row; the purge runs all the same.
    const preserved = await insertPhoto(t, bobsCopy, s.alice);
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "ownedPuzzleImages",
        rowId: preserved.imageId,
        uploaderId: s.alice,
        fileId: preserved.fileId,
        md5: "m",
        sha1: "s",
        provider: "test",
        originalDiscarded: true,
        status: "open",
        matchedAt: Date.now(),
      }),
    );

    await deleteMember(t, "alice");

    const rows = await t.run(async (ctx) => ({
      quarantined: await ctx.db.get(quarantined.imageId),
      quarantinedOnOwn: await ctx.db.get(quarantinedOnOwn.imageId),
      plain: await ctx.db.get(plain.imageId),
      preserved: await ctx.db.get(preserved.imageId),
    }));
    expect(rows.quarantined).not.toBeNull();
    expect(rows.quarantinedOnOwn).not.toBeNull();
    expect(rows.plain).toBeNull();
    expect(rows.preserved).toBeNull();
    expect(await blobExists(t, quarantined.fileId)).toBe(true);
    expect(await blobExists(t, quarantinedOnOwn.fileId)).toBe(true);
    expect(await blobExists(t, plain.fileId)).toBe(false);
    expect(await blobExists(t, preserved.fileId)).toBe(true);
  });
});

describe("account deletion: batching", () => {
  test("a small batch walks her copies over several runs", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const copies: Id<"ownedPuzzles">[] = [];
    for (let i = 0; i < 7; i++) {
      const copy = await insertCopy(t, s.puzzleId, s.alice);
      await insertPhoto(t, copy, s.alice);
      copies.push(copy);
    }
    const bobsCopy = await insertCopy(t, s.puzzleId, s.bob);

    await t.mutation(
      internal.conversation.purgeMemberMessagingData.purgeMemberMessagingData,
      { memberId: s.alice, phase: "copies", batchSize: 2 },
    );
    // One run handles one page: two copies, and the next run is scheduled with the cursor.
    const afterFirst = await t.run((ctx) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", s.alice))
        .collect(),
    );
    expect(afterFirst).toHaveLength(5);
    const next = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(next[next.length - 1]?.args[0]).toMatchObject({
      phase: "copies",
      batchSize: 2,
      cursor: expect.any(String),
    });

    await settleDueJobs(t);

    const rest = await t.run(async (ctx) => ({
      hers: await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", s.alice))
        .collect(),
      images: await ctx.db.query("ownedPuzzleImages").collect(),
      bobs: await ctx.db.get(bobsCopy),
    }));
    expect(rest.hers).toEqual([]);
    expect(rest.images).toEqual([]);
    expect(rest.bobs).not.toBeNull();
  });
});

describe("account deletion: goals, collections, categories", () => {
  test("hers are deleted, Bob's stay", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const bobsCopy = await insertCopy(t, s.puzzleId, s.bob);
    const insertRows = (userId: Id<"users">) =>
      t.run(async (ctx) => {
        const now = Date.now();
        await ctx.db.insert("goals", {
          userId,
          title: "Ten this year",
          targetCompletions: 10,
          currentCompletions: 2,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("categories", {
          userId,
          name: "Landscapes",
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        });
        const collectionId = await ctx.db.insert("collections", {
          userId,
          name: "Wishlist",
          visibility: "public",
          isDefault: false,
          isWishlist: true,
          wishedDefinitions: ["def-1"],
          createdAt: now,
          updatedAt: now,
        });
        // A membership left pointing at a copy (a legacy row; normally only own copies).
        await ctx.db.insert("collectionMembers", {
          collectionId,
          ownedPuzzleId: bobsCopy,
          addedAt: now,
        });
      });
    await insertRows(s.alice);
    await insertRows(s.bob);

    await deleteMember(t, "alice");

    const owners = await t.run(async (ctx) => ({
      goals: (await ctx.db.query("goals").collect()).map((r) => r.userId),
      categories: (await ctx.db.query("categories").collect()).map(
        (r) => r.userId,
      ),
      collections: (await ctx.db.query("collections").collect()).map(
        (r) => r.userId,
      ),
      memberships: (await ctx.db.query("collectionMembers").collect()).length,
      bobsCopy: await ctx.db.get(bobsCopy),
    }));
    expect(owners.goals).toEqual([s.bob]);
    expect(owners.categories).toEqual([s.bob]);
    expect(owners.collections).toEqual([s.bob]);
    expect(owners.memberships).toBe(1);
    expect(owners.bobsCopy).not.toBeNull();
  });
});

describe("account deletion: circles she owns", () => {
  type Seat = [Id<"users">, "ViewOnly" | "Exchange" | "Admin"];
  let circleSeq = 0;
  // A circle owned by `owner`, seated in the given order (earlier = longer-standing).
  const insertCircle = (t: T, owner: Id<"users">, seats: Seat[]) =>
    t.run(async (ctx) => {
      circleSeq += 1;
      const aggregateId = `circle-${circleSeq}`;
      const base = Date.now() - 100_000;
      const all: Seat[] = [[owner, "Admin"], ...seats];
      await ctx.db.insert("circles", {
        aggregateId,
        ownerId: owner,
        name: `Circle ${circleSeq}`,
        memberships: all.map(([memberId, permission], i) => ({
          id: `${aggregateId}-m${i}`,
          memberId,
          permission,
          joinedAt: base + i * 1000,
        })),
        createdAt: base,
      });
      for (const [memberId] of all) {
        await ctx.db.insert("circleMembers", {
          circleAggregateId: aggregateId,
          memberId,
        });
      }
      return aggregateId;
    });

  const circleOf = (t: T, aggregateId: string) =>
    t.run(async (ctx) => ({
      row: await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
        .unique(),
      links: (
        await ctx.db
          .query("circleMembers")
          .withIndex("by_circle", (q) => q.eq("circleAggregateId", aggregateId))
          .collect()
      ).map((l) => l.memberId),
    }));

  const permissionOf = (row: Doc<"circles"> | null, memberId: Id<"users">) =>
    row?.memberships.find((m) => m.memberId === memberId)?.permission;

  test("an Admin takes over before a longer-standing plain member; her seat stays", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const circle = await insertCircle(t, s.alice, [
      [s.carol, "Exchange"],
      [s.bob, "Admin"],
    ]);

    await deleteMember(t, "alice");

    const { row, links } = await circleOf(t, circle);
    expect(row?.ownerId).toBe(s.bob);
    expect(permissionOf(row, s.bob)).toBe("Admin");
    expect(permissionOf(row, s.carol)).toBe("Exchange");
    // Her seat stays, as a departed seat.
    expect(row?.memberships.map((m) => m.memberId)).toContain(s.alice);
    expect(links).toEqual(expect.arrayContaining([s.alice, s.bob, s.carol]));
  });

  test("a departed Admin is skipped; with no active Admin the longest-standing member takes over", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await t.run((ctx) => ctx.db.patch(s.dave, { isActive: false }));
    const circle = await insertCircle(t, s.alice, [
      [s.dave, "Admin"],
      [s.carol, "ViewOnly"],
      [s.bob, "Exchange"],
    ]);

    await deleteMember(t, "alice");

    const { row } = await circleOf(t, circle);
    expect(row?.ownerId).toBe(s.carol);
    expect(permissionOf(row, s.carol)).toBe("Admin");
    expect(permissionOf(row, s.bob)).toBe("Exchange");
  });

  test("a circle with nobody active left is deleted", async () => {
    const t = newT();
    const s = await seedMembers(t);
    await t.run((ctx) => ctx.db.patch(s.dave, { isActive: false }));
    const circle = await insertCircle(t, s.alice, [[s.dave, "Admin"]]);
    const kept = await insertCircle(t, s.bob, [[s.alice, "Exchange"]]);

    await deleteMember(t, "alice");

    expect(await circleOf(t, circle)).toEqual({ row: null, links: [] });
    // Her seat in Bob's circle stays as a departed seat.
    const bobs = await circleOf(t, kept);
    expect(bobs.row?.ownerId).toBe(s.bob);
    expect(bobs.links).toContain(s.alice);
  });

  test("the new owner can act as owner", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const circle = await insertCircle(t, s.alice, [[s.bob, "Exchange"]]);
    await deleteMember(t, "alice");

    await as(t, "bob").mutation(api.sharing.removeMember.removeMember, {
      circleId: circle,
      memberId: s.alice,
    });
    const { row } = await circleOf(t, circle);
    expect(row?.memberships.map((m) => m.memberId)).toEqual([s.bob]);
  });
});

describe("account deletion: household", () => {
  let householdSeq = 0;
  const insertHousehold = (
    t: T,
    seats: Array<[Id<"users">, "admin" | "member"]>,
  ) =>
    t.run(async (ctx) => {
      householdSeq += 1;
      const householdId = `household-${householdSeq}`;
      const base = Date.now() - 100_000;
      await ctx.db.insert("households", {
        aggregateId: householdId,
        createdAt: base,
      });
      for (const [i, [memberId, role]] of seats.entries()) {
        await ctx.db.insert("householdMembers", {
          householdId,
          memberId,
          role,
          joinedAt: base + i * 1000,
        });
      }
      return householdId;
    });

  const seatsOf = (t: T, householdId: string) =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("householdMembers")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      ).map((m) => [m.memberId, m.role]),
    );

  test("her admin seat goes to the longest-standing member", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const household = await insertHousehold(t, [
      [s.alice, "admin"],
      [s.carol, "member"],
      [s.bob, "member"],
    ]);

    await deleteMember(t, "alice");

    expect(await seatsOf(t, household)).toEqual(
      expect.arrayContaining([
        [s.carol, "admin"],
        [s.bob, "member"],
      ]),
    );
    expect(await seatsOf(t, household)).toHaveLength(2);
  });

  test("her admin seat skips members whose accounts are already gone", async () => {
    const t = newT();
    const s = await seedMembers(t);
    // Carol and Dave left before the purge took households along: Carol's row is deleted, Dave's
    // is tombstoned. Both joined before Bob.
    const household = await insertHousehold(t, [
      [s.alice, "admin"],
      [s.carol, "member"],
      [s.dave, "member"],
      [s.bob, "member"],
    ]);
    await t.run(async (ctx) => {
      await ctx.db.delete(s.carol);
      await ctx.db.patch(s.dave, { isActive: false });
    });

    await deleteMember(t, "alice");

    expect(await seatsOf(t, household)).toEqual([[s.bob, "admin"]]);
  });

  test("with only departed members left beside her, her household is dissolved", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const household = await insertHousehold(t, [
      [s.alice, "admin"],
      [s.carol, "member"],
    ]);
    await t.run((ctx) => ctx.db.delete(s.carol));

    await deleteMember(t, "alice");

    expect(await seatsOf(t, household)).toEqual([]);
  });

  test("as its sole member, her household is dissolved", async () => {
    const t = newT();
    const s = await seedMembers(t);
    const household = await insertHousehold(t, [[s.alice, "admin"]]);

    await deleteMember(t, "alice");

    expect(await seatsOf(t, household)).toEqual([]);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("households")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", household))
          .unique(),
      ),
    ).toBeNull();
  });
});
