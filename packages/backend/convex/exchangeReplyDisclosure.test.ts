import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-08: the owner's first message in an exchange's own thread reveals their trade card (name,
// handle, reviews received) to the requester, inside that exchange (tradeRevealSubscriber,
// "owner_replied"). exchange/getReplyDisclosure tells the OWNER, before that reply, whether it
// would reveal them, so the composer can say so. It answers only the owner, and only from facts
// the owner already knows (their own visibility, follows and actions); blocks never change it.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

const EXCHANGE_REF = "exchange-agg-1";

// A private owner, a requester who proposed a trade for the owner's copy, and a third member.
const seed = (t: T, opts: { aggregateId?: boolean } = {}) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
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
    const owner = await mkUser("owner");
    const requester = await mkUser("requester");
    await mkUser("third");
    const ownerProfile = await ctx.db.insert("profiles", {
      memberId: owner,
      visibility: "private",
      updatedAt: now,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });
    const exchangeId = await ctx.db.insert("exchanges", {
      ...(opts.aggregateId === false ? {} : { aggregateId: EXCHANGE_REF }),
      initiatorId: requester,
      recipientId: owner,
      type: "trade",
      requestedPuzzleId: copy,
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    });
    return { owner, requester, ownerProfile, exchangeId };
  });

type World = Awaited<ReturnType<typeof seed>>;

const disclosureFor = (t: T, who: string, exchangeId: string = EXCHANGE_REF) =>
  as(t, who).query(api.exchange.getReplyDisclosure.getReplyDisclosure, {
    exchangeId,
  });

const follow = (t: T, followerId: Id<"users">, followeeId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 }),
  );

const block = (t: T, blockerId: Id<"users">, blockedId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db.insert("blocks", { blockerId, blockedId, createdAt: 1 }),
  );

const makePublic = (t: T, w: World) =>
  t.run((ctx) => ctx.db.patch(w.ownerProfile, { visibility: "public" }));

describe("getReplyDisclosure (SEC-08 composer hint)", () => {
  test("a hidden owner who hasn't acted yet is told a reply would reveal them", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await disclosureFor(t, "owner")).toEqual({ revealsYou: true });
  });

  test("once the owner accepted or replied, a reply reveals nothing new", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await t.run((ctx) =>
      ctx.db.insert("tradeReveals", {
        exchangeId: w.exchangeId,
        reason: "owner_replied",
        revealedAt: 2,
      }),
    );
    expect(await disclosureFor(t, "owner")).toEqual({ revealsYou: false });
  });

  test("an owner the requester already sees (public, or mutual followers) reveals nothing new", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await follow(t, w.owner, w.requester);
    expect(await disclosureFor(t, "owner")).toEqual({ revealsYou: true });
    await follow(t, w.requester, w.owner);
    expect(await disclosureFor(t, "owner")).toEqual({ revealsYou: false });

    const t2 = convexTest(schema, modules);
    const w2 = await seed(t2);
    await makePublic(t2, w2);
    expect(await disclosureFor(t2, "owner")).toEqual({ revealsYou: false });
  });

  test("a block either way never changes the answer", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    await block(t, w.requester, w.owner);
    expect(await disclosureFor(t, "owner")).toEqual({ revealsYou: true });

    const t2 = convexTest(schema, modules);
    const w2 = await seed(t2);
    await makePublic(t2, w2);
    await block(t2, w2.requester, w2.owner);
    await block(t2, w2.owner, w2.requester);
    expect(await disclosureFor(t2, "owner")).toEqual({ revealsYou: false });
  });

  test("answers only the owner: the requester, a third member and an unknown exchange get null", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await disclosureFor(t, "requester")).toBeNull();
    expect(await disclosureFor(t, "third")).toBeNull();
    expect(await disclosureFor(t, "owner", "no-such-exchange")).toBeNull();
    await expect(
      t.query(api.exchange.getReplyDisclosure.getReplyDisclosure, {
        exchangeId: EXCHANGE_REF,
      }),
    ).rejects.toThrow();
  });

  test("an exchange that predates aggregate ids resolves by its raw id", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t, { aggregateId: false });
    expect(await disclosureFor(t, "owner", w.exchangeId)).toEqual({
      revealsYou: true,
    });
  });
});
