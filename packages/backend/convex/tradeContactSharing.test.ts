import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Consented contact sharing (SEC-08). A member's email reaches their trade partner ONLY after they
// turned on "Share my email" for that one exchange (exchange/setContactSharing), and only while it
// is accepted, completed or disputed with no block either way (domain rule tradeEmailVisible).
// Requesting, replying, accepting or a public profile never share it; a cancel hides it again.

type T = TestConvex<typeof schema>;
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

// The dispatcher runs via runAfter(0); yield a macrotask then drain, a few times to settle chains.
const flush = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

type World = {
  owner: Id<"users">;
  requester: Id<"users">;
  copies: Id<"ownedPuzzles">[];
};

// A PUBLIC owner with `copyCount` open copies (so anyone may request them), a requester and a
// third member who is party to nothing.
const seed = (t: T, copyCount = 1): Promise<World> =>
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
    await ctx.db.insert("profiles", {
      aggregateId: `prof-${owner}`,
      memberId: owner,
      displayName: "Olivia",
      visibility: "public",
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
    const copies: Id<"ownedPuzzles">[] = [];
    for (let i = 0; i < copyCount; i++) {
      copies.push(
        await ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId: owner,
          condition: "good",
          availability: { forTrade: false, forSale: true, forLend: false },
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return { owner, requester, copies };
  });

/** Propose a sale; returns the exchange's Convex _id and its aggregate id. */
const propose = async (t: T, requestedPuzzleId: Id<"ownedPuzzles">) => {
  const aggregateId = await as(t, "requester").mutation(
    api.exchange.propose.propose,
    { type: "sale", salePrice: 10, requestedPuzzleId },
  );
  await flush(t);
  const row = await t.run((ctx) =>
    ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );
  return { id: row!._id, aggregateId };
};

const act = async (
  t: T,
  who: string,
  action: "accept" | "decline" | "cancel",
  exchangeId: string,
) => {
  const fn = {
    accept: api.exchange.accept.accept,
    decline: api.exchange.decline.decline,
    cancel: api.exchange.cancel.cancel,
  }[action];
  await as(t, who).mutation(fn, { exchangeId });
  await flush(t);
};

const post = async (t: T, who: string, exchangeId: string, body: string) => {
  const threadId = await as(t, who).query(
    api.conversation.getThreadByExchange.getThreadByExchange,
    { exchangeId },
  );
  await as(t, who).mutation(api.conversation.postMessage.postMessage, {
    threadId: threadId!,
    kind: "text",
    body,
  });
  await flush(t);
};

const card = (t: T, who: string, exchangeId: Id<"exchanges">) =>
  as(t, who).query(api.exchange.getTradePartner.getTradePartner, {
    exchangeId,
  });

const share = (t: T, who: string, exchangeId: Id<"exchanges">, on: boolean) =>
  as(t, who).mutation(api.exchange.setContactSharing.setContactSharing, {
    exchangeId,
    share: on,
  });

const shareRows = (t: T) =>
  t.run((ctx) => ctx.db.query("tradeContactShares").collect());

describe("no email without consent", () => {
  // The review's repro proposed on 25 copies; a handful shows the same (throttling proposals is a
  // separate concern), and stays under any per-member proposal cap.
  test("the review repro: proposals, a 'No thanks' reply and a decline reveal no email", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t, 5);
    const exchanges = [];
    for (const copy of w.copies) exchanges.push(await propose(t, copy));
    const target = exchanges[0]!;

    await post(t, "requester", target.aggregateId, "Is this still available?");
    await post(t, "owner", target.aggregateId, "No thanks");
    // The reply still reveals the owner's name inside the trade, but never the email.
    expect(await card(t, "requester", target.id)).toMatchObject({
      state: "revealed",
      memberId: w.owner,
      emailSharing: { youShare: false, open: false },
    });
    await act(t, "owner", "decline", target.aggregateId);

    for (const exchange of exchanges) {
      expect(await card(t, "requester", exchange.id)).not.toHaveProperty(
        "email",
      );
      // Nor does sending a request hand the requester's email to the owner.
      expect(await card(t, "owner", exchange.id)).not.toHaveProperty("email");
    }
    expect(JSON.stringify(await card(t, "requester", target.id))).not.toContain(
      "owner@example.com",
    );
  });

  test("accepting alone shares nothing; sharing is now open on both sides", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);

    for (const who of ["requester", "owner"]) {
      const view = await card(t, who, ex.id);
      expect(view).toMatchObject({
        state: "revealed",
        emailSharing: { youShare: false, open: true },
      });
      expect(view).not.toHaveProperty("email");
    }
  });
});

describe("setContactSharing", () => {
  test("a share shows that party's email to the other party only, and unsharing hides it", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);

    await share(t, "owner", ex.id, true);
    expect(await card(t, "requester", ex.id)).toMatchObject({
      email: "owner@example.com",
      emailSharing: { youShare: false, open: true },
    });
    // The owner sees their own switch on, and still no email from the requester, who didn't share.
    const ownerView = await card(t, "owner", ex.id);
    expect(ownerView).toMatchObject({
      emailSharing: { youShare: true, open: true },
    });
    expect(ownerView).not.toHaveProperty("email");

    await share(t, "requester", ex.id, true);
    expect(await card(t, "owner", ex.id)).toMatchObject({
      email: "requester@example.com",
    });

    await share(t, "owner", ex.id, false);
    expect(await card(t, "requester", ex.id)).not.toHaveProperty("email");
    expect(await card(t, "owner", ex.id)).toMatchObject({
      email: "requester@example.com",
    });
  });

  test("is idempotent: one row per side however often it is turned on or off", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);

    await share(t, "owner", ex.id, true);
    await share(t, "owner", ex.id, true);
    expect(await shareRows(t)).toMatchObject([
      { exchangeId: ex.id, side: "recipient" },
    ]);
    await share(t, "owner", ex.id, false);
    await share(t, "owner", ex.id, false);
    expect(await shareRows(t)).toEqual([]);
  });

  test("a cancel after acceptance hides a shared email again", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);
    await share(t, "owner", ex.id, true);
    await share(t, "requester", ex.id, true);

    await act(t, "requester", "cancel", ex.aggregateId);

    for (const who of ["requester", "owner"]) {
      const view = await card(t, who, ex.id);
      expect(view).not.toHaveProperty("email");
      expect(view).toMatchObject({
        emailSharing: { youShare: true, open: false },
      });
    }
    // Withdrawing consent stays possible after the trade closed.
    await share(t, "owner", ex.id, false);
    expect(await shareRows(t)).toMatchObject([{ side: "initiator" }]);
  });

  test("turning sharing on is refused before acceptance and after a decline", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);

    for (const who of ["requester", "owner"]) {
      await expect(share(t, who, ex.id, true)).rejects.toThrow(
        /ContactSharingClosed/,
      );
    }
    // Turning it off is always allowed (a no-op here).
    await share(t, "requester", ex.id, false);

    await act(t, "owner", "decline", ex.aggregateId);
    await expect(share(t, "owner", ex.id, true)).rejects.toThrow(
      /ContactSharingClosed/,
    );
    expect(await shareRows(t)).toEqual([]);
  });

  test("a non-party, a missing exchange and a signed-out caller can't toggle it", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);

    for (const on of [true, false]) {
      await expect(share(t, "third", ex.id, on)).rejects.toThrow(
        /ExchangeNotFound/,
      );
    }
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("exchanges", {
        initiatorId: w.requester,
        recipientId: w.owner,
        type: "sale",
        requestedPuzzleId: w.copies[0]!,
        status: "accepted",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(share(t, "owner", gone, true)).rejects.toThrow(
      /ExchangeNotFound/,
    );
    await expect(
      t.mutation(api.exchange.setContactSharing.setContactSharing, {
        exchangeId: ex.id,
        share: true,
      }),
    ).rejects.toThrow(/Unauthenticated/);
    expect(await shareRows(t)).toEqual([]);
  });

  test("a block either way closes sharing and hides a shared email", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const ex = await propose(t, w.copies[0]!);
    await act(t, "owner", "accept", ex.aggregateId);
    await share(t, "owner", ex.id, true);
    await share(t, "requester", ex.id, true);

    await t.run((ctx) =>
      ctx.db.insert("blocks", {
        blockerId: w.requester,
        blockedId: w.owner,
        createdAt: 1,
      }),
    );

    // The blocker keeps the trade card but no longer sees the email, and can't share.
    const blockerView = await card(t, "requester", ex.id);
    expect(blockerView).toMatchObject({
      state: "revealed",
      emailSharing: { youShare: true, open: false },
    });
    expect(blockerView).not.toHaveProperty("email");
    // The blocked party sees the blocker hidden, so the requester's shared email is gone too.
    expect(await card(t, "owner", ex.id)).toEqual({ state: "hidden" });
    await expect(share(t, "owner", ex.id, true)).rejects.toThrow(
      /ContactSharingClosed/,
    );
  });
});
