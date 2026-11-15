import { convexTest, type TestConvex } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Alice (initiator) proposes a trade to Bob (recipient): she offers her copy of "Ocean Calm" for
// his copy of "Mountain Vista". A second, finished exchange offers nothing in return.
const seed = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();

    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      avatar: "https://img/alice.png",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const mountain = await ctx.db.insert("puzzles", {
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    const ocean = await ctx.db.insert("puzzles", {
      title: "Ocean Calm",
      pieceCount: 500,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });

    const bobsCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: mountain,
      ownerId: bob,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      // Owner-only personal fields — must never reach the counterparty (Alice).
      notes: "bob-private-note-mountain",
      acquisitionSource: "bought_used",
      acquisitionDate: now - 99_999,
      acquisitionPrice: { amount: 4321, currency: "EUR" },
      createdAt: now,
      updatedAt: now,
    });
    const alicesCopy = await ctx.db.insert("ownedPuzzles", {
      puzzleId: ocean,
      ownerId: alice,
      condition: "like_new",
      availability: { forTrade: true, forSale: false, forLend: false },
      // Owner-only personal fields — must never reach the counterparty (Bob).
      notes: "alice-private-note-ocean",
      acquisitionSource: "gift",
      acquisitionDate: now - 88_888,
      acquisitionPrice: { amount: 1234, currency: "USD" },
      createdAt: now,
      updatedAt: now,
    });

    const older = await ctx.db.insert("exchanges", {
      aggregateId: "exch-1",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      offeredPuzzleId: alicesCopy,
      status: "proposed",
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    const newer = await ctx.db.insert("exchanges", {
      aggregateId: "exch-2",
      initiatorId: alice,
      recipientId: bob,
      type: "trade",
      requestedPuzzleId: bobsCopy,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });

    return { alice, bob, older, newer, mountain, ocean, alicesCopy };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });

// Every row the member's Exchanges page lists: what is still in play, then the finished ones.
const listedExchanges = async (reader: ReturnType<typeof asAlice>) => {
  const [live, history] = await Promise.all([
    reader.query(api.exchange.listMyLiveExchanges.listMyLiveExchanges, {}),
    reader.query(api.exchange.listMyExchangeHistory.listMyExchangeHistory, {
      paginationOpts: { numItems: 50, cursor: null },
    }),
  ]);
  return [...live, ...history.page];
};

// One exchange as the caller's own lists show it (null when they are no party to it).
const rowOf = async (
  c: ReturnType<typeof asAlice>,
  exchangeId: Id<"exchanges">,
) => (await listedExchanges(c)).find((row) => row._id === exchangeId) ?? null;

describe("the exchange lists: one exchange", () => {
  test("returns the exchange with parties and the owned copies", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    const view = await rowOf(asAlice(t), older);
    expect(view?.requester?.name).toBe("Alice");
    expect(view?.owner?.name).toBe("Bob");
    expect(view?.requestedOwnedPuzzle?.condition).toBe("good");
    expect(view?.offeredOwnedPuzzle?.condition).toBe("like_new");
  });

  test("a non-party caller does not get it", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    // Carol is neither initiator nor recipient.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "Carol",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const view = await rowOf(t.withIdentity({ subject: "clerk_carol" }), older);
    expect(view).toBeNull();
  });

  test("a missing exchange is not listed", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await t.run(async (ctx) => ctx.db.delete(older));
    expect(await rowOf(asAlice(t), older)).toBeNull();
  });
});

describe("exchange owner-only field gating (counterparty must not see private copy data)", () => {
  // Alice owns Ocean Calm (offered), Bob owns Mountain Vista (requested). On the shared exchange
  // view each party must see owner-only fields (notes + acquisition provenance) ONLY on their own
  // copy, never on the counterparty's. salePrice is public and is not asserted here.
  // Unique string sentinels only. The acquisitionPrice (a number) is collision-prone as a JSON
  // substring — random convex ids/timestamps can contain "1234"/"4321" — so it is NOT substring-
  // checked here; each test asserts the counterparty's `acquisitionPrice` is `undefined` directly.
  const BOB_SECRETS = ["bob-private-note-mountain", "bought_used"] as const;
  const ALICE_SECRETS = ["alice-private-note-ocean", "gift"] as const;

  test("the exchange lists (one exchange): each party sees only their own copy's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);

    // Alice is the initiator: requestedOwnedPuzzle = Bob's copy, offeredOwnedPuzzle = Alice's.
    const aliceView = await rowOf(asAlice(t), older);
    expect(aliceView?.offeredOwnedPuzzle?.notes).toBe(
      "alice-private-note-ocean",
    );
    expect(aliceView?.offeredOwnedPuzzle?.acquisitionSource).toBe("gift");
    expect(aliceView?.offeredOwnedPuzzle?.acquisitionPrice?.amount).toBe(1234);
    expect(aliceView?.offeredOwnedPuzzle?.acquisitionDate).toBeDefined();
    // Bob's copy (the counterparty's) must be stripped of every owner-only field.
    expect(aliceView?.requestedOwnedPuzzle?.notes).toBeUndefined();
    expect(aliceView?.requestedOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(aliceView?.requestedOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    expect(aliceView?.requestedOwnedPuzzle?.acquisitionDate).toBeUndefined();
    const aliceJson = JSON.stringify(aliceView);
    for (const secret of BOB_SECRETS) {
      expect(aliceJson).not.toContain(secret);
    }

    // Bob is the recipient: he must see his own copy's fields and none of Alice's.
    const bobView = await rowOf(asBob(t), older);
    expect(bobView?.requestedOwnedPuzzle?.notes).toBe(
      "bob-private-note-mountain",
    );
    expect(bobView?.requestedOwnedPuzzle?.acquisitionSource).toBe(
      "bought_used",
    );
    expect(bobView?.requestedOwnedPuzzle?.acquisitionPrice?.amount).toBe(4321);
    expect(bobView?.offeredOwnedPuzzle?.notes).toBeUndefined();
    expect(bobView?.offeredOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(bobView?.offeredOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    expect(bobView?.offeredOwnedPuzzle?.acquisitionDate).toBeUndefined();
    const bobJson = JSON.stringify(bobView);
    for (const secret of ALICE_SECRETS) {
      expect(bobJson).not.toContain(secret);
    }
  });

  test("the exchange lists: initiator never receives the recipient's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const list = await listedExchanges(asAlice(t));
    const older = list.find((e) => e.aggregateId === "exch-1");
    // Alice owns the offered copy; she sees its owner-only fields.
    expect(older?.offeredOwnedPuzzle?.notes).toBe("alice-private-note-ocean");
    // Bob's requested copy is the counterparty's — stripped.
    expect(older?.requestedOwnedPuzzle?.notes).toBeUndefined();
    expect(older?.requestedOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(older?.requestedOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    const json = JSON.stringify(list);
    for (const secret of BOB_SECRETS) {
      expect(json).not.toContain(secret);
    }
  });

  test("the exchange lists: recipient never receives the initiator's owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const incoming = await listedExchanges(asBob(t));
    const older = incoming.find((e) => e.aggregateId === "exch-1");
    // Bob owns the requested copy; he sees its owner-only fields.
    expect(older?.requestedOwnedPuzzle?.notes).toBe(
      "bob-private-note-mountain",
    );
    // Alice's offered copy is the counterparty's — stripped.
    expect(older?.offeredOwnedPuzzle?.notes).toBeUndefined();
    expect(older?.offeredOwnedPuzzle?.acquisitionSource).toBeUndefined();
    expect(older?.offeredOwnedPuzzle?.acquisitionPrice).toBeUndefined();
    const json = JSON.stringify(incoming);
    for (const secret of ALICE_SECRETS) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("the legacy exchange lists", () => {
  // listMyLiveExchanges and listMyExchangeHistory replaced them; no client calls them any more.
  test.each([
    "exchange/getUserExchanges:getUserExchanges",
    "exchange/getExchangesByOwner:getExchangesByOwner",
    "exchange/getExchangesByRequester:getExchangesByRequester",
  ])("%s is gone", async (name) => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asAlice(t).query(makeFunctionReference<"query">(name), {}),
    ).rejects.toThrow(`Could not find module for: "${name.split(":")[0]}"`);
  });
});

describe("exchange summary covers", () => {
  // Each copy's cover resolves like every library card (resolveCopyCoverUrl): its approved cover
  // photo, else the puzzle's box art. The row carries URLs, never the raw storage ids.
  test("both parties get each copy's cover as a URL: box art for one, the cover photo for the other", async () => {
    const t = convexTest(schema, modules);
    const { alice, mountain, alicesCopy } = await seed(t);
    const { boxArt, photoBlob } = await t.run(async (ctx) => {
      const boxArt = await ctx.storage.store(
        new Blob(["box-art"], { type: "image/png" }),
      );
      await ctx.db.patch(mountain, { image: boxArt });
      const photoBlob = await ctx.storage.store(
        new Blob(["cover-photo"], { type: "image/png" }),
      );
      const photo = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: alicesCopy,
        uploaderId: alice,
        fileId: photoBlob,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(alicesCopy, { coverImageId: photo });
      return { boxArt, photoBlob };
    });

    const asRequester = await listedExchanges(asAlice(t));
    const asRecipient = await listedExchanges(asBob(t));
    for (const list of [asRequester, asRecipient]) {
      const row = list.find((e) => e.aggregateId === "exch-1");
      expect(row?.requestedCoverUrl).toMatch(/^https?:\/\//);
      expect(row?.offeredCoverUrl).toMatch(/^https?:\/\//);
      expect(row?.requestedCoverUrl).not.toContain(boxArt);
      expect(row?.offeredCoverUrl).not.toContain(photoBlob);
      expect(row?.offeredCoverUrl).not.toBe(row?.requestedCoverUrl);
    }
  });

  test("a copy without cover photo or box art, and a missing offered copy, give null", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const list = await listedExchanges(asAlice(t));
    const swap = list.find((e) => e.aggregateId === "exch-1");
    expect(swap?.requestedCoverUrl).toBeNull();
    expect(swap?.offeredCoverUrl).toBeNull();
    // exch-2 offers nothing in return.
    const oneSided = list.find((e) => e.aggregateId === "exch-2");
    expect(oneSided?.offeredCoverUrl).toBeNull();
  });
});

describe("exchange summary covers respect who may see the copy", () => {
  // A member's own cover photo is personal; the row shows it only to a viewer the copy page would
  // show it to (canViewCopy). Anyone else gets the catalogue box art, or null without any.
  const withPhoto = async (
    t: TestConvex<typeof schema>,
    {
      owner,
      copy,
      puzzle,
      boxArt = false,
    }: {
      owner: Id<"users">;
      copy: Id<"ownedPuzzles">;
      puzzle?: Id<"puzzles">;
      boxArt?: boolean;
    },
  ) =>
    t.run(async (ctx) => {
      const photoBlob = await ctx.storage.store(
        new Blob(["cover-photo"], { type: "image/png" }),
      );
      const photo = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: owner,
        fileId: photoBlob,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch(copy, { coverImageId: photo });
      const photoUrl = await ctx.storage.getUrl(photoBlob);
      let boxArtUrl: string | null = null;
      if (boxArt && puzzle) {
        const art = await ctx.storage.store(
          new Blob(["box-art"], { type: "image/png" }),
        );
        await ctx.db.patch(puzzle, { image: art });
        boxArtUrl = await ctx.storage.getUrl(art);
      }
      return { photoUrl, boxArtUrl };
    });

  // Bob's incoming row for the swap in which Alice offers her copy.
  const bobsRow = async (t: TestConvex<typeof schema>) =>
    (await listedExchanges(asBob(t))).find((e) => e.aggregateId === "exch-1");

  const alicesOutgoingRow = async (t: TestConvex<typeof schema>) =>
    (await listedExchanges(asAlice(t))).find((e) => e.aggregateId === "exch-1");

  const seedPrivateCopy = (
    t: TestConvex<typeof schema>,
    copy: Id<"ownedPuzzles">,
  ) =>
    t.run((ctx) =>
      ctx.db.patch(copy, {
        availability: { forTrade: false, forSale: false, forLend: false },
        visibility: "private",
        visibilityAuthoritative: true,
      }),
    );

  const setStatus = (
    t: TestConvex<typeof schema>,
    exchange: Id<"exchanges">,
    status: "rejected" | "cancelled" | "accepted",
  ) => t.run((ctx) => ctx.db.patch(exchange, { status }));

  test("a member the owner blocked gets no cover photo, also one set after the block", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, alicesCopy } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: alice,
        blockedId: bob,
        createdAt: 1,
      }),
    );
    const { photoUrl } = await withPhoto(t, { owner: alice, copy: alicesCopy });

    const row = await bobsRow(t);
    expect(row?.requesterState).toBe("hidden");
    expect(row?.offeredCoverUrl).toBeNull();
    expect(JSON.stringify(row)).not.toContain(photoUrl);
    // The owner keeps their own photo on the same exchange.
    expect((await alicesOutgoingRow(t))?.offeredCoverUrl).toBe(photoUrl);
  });

  test("a member who blocked the owner gets no cover photo either: the veto works both ways", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, alicesCopy } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: bob,
        blockedId: alice,
        createdAt: 1,
      }),
    );
    const { photoUrl } = await withPhoto(t, { owner: alice, copy: alicesCopy });

    const row = await bobsRow(t);
    expect(row?.offeredCoverUrl).toBeNull();
    expect(JSON.stringify(row)).not.toContain(photoUrl);
  });

  test("a viewer refused the photo still gets the catalogue box art", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, alicesCopy, ocean } = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: alice,
        blockedId: bob,
        createdAt: 1,
      }),
    );
    const { photoUrl, boxArtUrl } = await withPhoto(t, {
      owner: alice,
      copy: alicesCopy,
      puzzle: ocean,
      boxArt: true,
    });
    expect(boxArtUrl).not.toBeNull();

    const row = await bobsRow(t);
    expect(row?.offeredCoverUrl).toBe(boxArtUrl);
    expect(JSON.stringify(row)).not.toContain(photoUrl);
  });

  test.each(["rejected", "cancelled"] as const)(
    "a %s swap of a private copy gives the counterparty no cover photo: the owner's choice wins again",
    async (status) => {
      const t = convexTest(schema, modules);
      const { alice, older, alicesCopy } = await seed(t);
      const { photoUrl } = await withPhoto(t, {
        owner: alice,
        copy: alicesCopy,
      });
      await seedPrivateCopy(t, alicesCopy);
      await setStatus(t, older, status);

      const row = await bobsRow(t);
      expect(row?.offeredCoverUrl).toBeNull();
      expect(JSON.stringify(row)).not.toContain(photoUrl);
      // The owner keeps their own photo.
      expect((await alicesOutgoingRow(t))?.offeredCoverUrl).toBe(photoUrl);
    },
  );

  test("a live swap of a private copy shows its cover photo to the other party", async () => {
    const t = convexTest(schema, modules);
    const { alice, older, alicesCopy } = await seed(t);
    const { photoUrl } = await withPhoto(t, { owner: alice, copy: alicesCopy });
    await seedPrivateCopy(t, alicesCopy);
    await setStatus(t, older, "accepted");

    // Rule P of canViewCopy: the owner put the copy in front of this member to trade on.
    expect((await bobsRow(t))?.offeredCoverUrl).toBe(photoUrl);
  });
});
