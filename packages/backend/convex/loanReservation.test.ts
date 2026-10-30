import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-36: an open loan reserves its copy. While Lena's copy X is at Bo's house it can't be offered
// again or deleted, no other deal on it can be accepted or settle, nobody can ask for it and Lena
// can't offer it in a swap. Once it is back, all of that works again. Driven through the real
// mutations and the async settlement dispatch.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Name = "lena" | "bo" | "carl" | "dana" | "rex";
type Ids = Record<Name, Id<"users">>;
type Copy = { aggregateId: string; id: Id<"ownedPuzzles"> };

const as = (t: T, name: Name) => t.withIdentity({ subject: `clerk_${name}` });

// The loan opens in a scheduled dispatch; yield then drain until it settles.
const flush = async (t: T) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Everyone has a public profile (no profile row) and nobody blocks anyone.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: Name) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ids: Ids = {
      lena: await mkUser("lena"),
      bo: await mkUser("bo"),
      carl: await mkUser("carl"),
      dana: await mkUser("dana"),
      rex: await mkUser("rex"),
    };
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ids.lena,
      createdAt: now,
      updatedAt: now,
    });
    return { ids, puzzleAggregateId };
  });

const acquire = async (
  t: T,
  owner: Name,
  puzzleAggregateId: string,
): Promise<Copy> => {
  const aggregateId = (await as(t, owner).mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
  )) as string;
  const row = await t.run((ctx) =>
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );
  if (!row) throw new Error("seed: copy not found");
  return { aggregateId, id: row._id };
};

const ALL_OFFERS = { forTrade: true, forSale: true, forLend: true };

const share = (
  t: T,
  owner: Name,
  copy: Copy,
  flags: { forTrade?: boolean; forSale?: boolean; forLend?: boolean },
) =>
  as(t, owner).mutation(api.library.updateCopySharing.updateCopySharing, {
    copyId: copy.aggregateId,
    visibility: "visible",
    ...flags,
  });

const deleteCopy = (t: T, owner: Name, copy: Copy) =>
  as(t, owner).mutation(api.library.deleteCopy.deleteCopy, {
    copyId: copy.aggregateId,
  });

const proposeSale = (t: T, buyer: Name, copy: Copy) =>
  as(t, buyer).mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: copy.id,
    salePrice: 1000,
  });

const proposeLend = (t: T, borrower: Name, copy: Copy) =>
  as(t, borrower).mutation(api.exchange.propose.propose, {
    type: "loan",
    requestedPuzzleId: copy.id,
  });

const proposeSwap = (t: T, initiator: Name, requested: Copy, offered: Copy) =>
  as(t, initiator).mutation(api.exchange.propose.propose, {
    type: "trade",
    requestedPuzzleId: requested.id,
    offeredPuzzleId: offered.id,
  });

const accept = (t: T, recipient: Name, exchangeId: string) =>
  as(t, recipient).mutation(api.exchange.accept.accept, { exchangeId });

const confirm = (t: T, party: Name, exchangeId: string) =>
  as(t, party).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId,
  });

const settle = async (
  t: T,
  exchangeId: string,
  initiator: Name,
  recipient: Name,
) => {
  await accept(t, recipient, exchangeId);
  await confirm(t, initiator, exchangeId);
  await confirm(t, recipient, exchangeId);
  await flush(t);
};

// A deal accepted before one deal per copy (and before a loan reserved the copy): set directly in
// the store, as such rows still are.
const acceptedBeforeTheRules = (t: T, exchangeId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
      .unique();
    if (!row) throw new Error("seed: exchange not found");
    await ctx.db.patch(row._id, { status: "accepted", updatedAt: Date.now() });
  });

const copyRow = async (t: T, copy: Copy) => {
  const row = await t.run((ctx) => ctx.db.get(copy.id));
  if (!row) throw new Error("copy vanished");
  return row;
};

const statusOf = (t: T, exchangeId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
          .unique()
      )?.status,
  );

const loansOf = (t: T, copy: Copy) =>
  t.run((ctx) =>
    ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", copy.aggregateId))
      .collect(),
  );

const openLoanId = async (t: T, copy: Copy): Promise<string> => {
  const open = (await loansOf(t, copy)).filter((l) => l.status === "open");
  if (open.length !== 1 || !open[0].aggregateId) {
    throw new Error("expected one open loan");
  }
  return open[0].aggregateId;
};

const offerable = async (t: T, viewer: Name, requested: Copy) =>
  (
    await as(t, viewer).query(
      api.exchange.getOfferableCopies.getOfferableCopies,
      { requestedPuzzleId: requested.id },
    )
  ).map((row) => row._id);

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  const data = (error as ConvexError<Value>).data;
  return (
    typeof data === "string" ? JSON.parse(data) : (data as { code?: string })
  ).code;
};

// Lena offers X for everything and lends it to Bo. With `pending`, Carl (a lend) and Dana (a sale)
// asked for X before the loan, and their requests are still open.
const setUp = async (pending: boolean) => {
  const t = convexTest(schema, modules);
  const { ids, puzzleAggregateId } = await seed(t);
  const x = await acquire(t, "lena", puzzleAggregateId);
  await share(t, "lena", x, ALL_OFFERS);
  const carlLend = pending ? await proposeLend(t, "carl", x) : "";
  const danaSale = pending ? await proposeSale(t, "dana", x) : "";
  await settle(t, await proposeLend(t, "bo", x), "bo", "lena");
  expect((await copyRow(t, x)).heldBy).toBe(ids.bo);
  return { t, ids, puzzleAggregateId, x, carlLend, danaSale };
};

describe("a copy out on loan stays in the Library until it is back", () => {
  test("Lena can't offer X again or delete it while Bo has it; both work once it is back", async () => {
    const { t, ids, x } = await setUp(false);

    expect(await codeOf(share(t, "lena", x, { forSale: true }))).toBe(
      "CopyReserved",
    );
    expect(await codeOf(deleteCopy(t, "lena", x))).toBe("CopyReserved");
    // Who may see it is still hers to choose; it just isn't offered.
    await share(t, "lena", x, {});
    expect((await copyRow(t, x)).availability).toEqual({
      forTrade: false,
      forSale: false,
      forLend: false,
    });

    await as(t, "lena").mutation(api.library.recallLoan.recallLoan, {
      loanId: await openLoanId(t, x),
    });
    expect((await copyRow(t, x)).heldBy).toBe(ids.lena);
    await share(t, "lena", x, { forSale: true });
    expect((await copyRow(t, x)).availability.forSale).toBe(true);
    await deleteCopy(t, "lena", x);
    expect(await t.run((ctx) => ctx.db.get(x.id))).toBeNull();
  });
});

describe("no other deal on a copy out on loan is agreed or settles", () => {
  test("a second lend: Lena's accept is refused, and so are both confirmations of one accepted before", async () => {
    const { t, ids, x, carlLend } = await setUp(true);

    expect(await codeOf(accept(t, "lena", carlLend))).toBe("CopyReserved");
    expect(await statusOf(t, carlLend)).toBe("proposed");

    await acceptedBeforeTheRules(t, carlLend);
    expect(await codeOf(confirm(t, "carl", carlLend))).toBe("CopyReserved");
    expect(await codeOf(confirm(t, "lena", carlLend))).toBe("CopyReserved");
    await flush(t);
    expect(await statusOf(t, carlLend)).toBe("accepted");
    expect((await loansOf(t, x)).map((l) => l.borrowerId)).toEqual([ids.bo]);
    expect((await copyRow(t, x)).heldBy).toBe(ids.bo);
  });

  test("a sale: Lena's accept is refused, and so are both confirmations of one accepted before", async () => {
    const { t, ids, x, danaSale } = await setUp(true);

    expect(await codeOf(accept(t, "lena", danaSale))).toBe("CopyReserved");
    expect(await statusOf(t, danaSale)).toBe("proposed");

    await acceptedBeforeTheRules(t, danaSale);
    expect(await codeOf(confirm(t, "dana", danaSale))).toBe("CopyReserved");
    expect(await codeOf(confirm(t, "lena", danaSale))).toBe("CopyReserved");
    await flush(t);
    expect(await statusOf(t, danaSale)).toBe("accepted");
    const row = await copyRow(t, x);
    expect(row.ownerId).toBe(ids.lena);
    expect(row.heldBy).toBe(ids.bo);
  });

  test("once Bo returns X, Lena can accept Dana's sale and it settles", async () => {
    const { t, ids, x, danaSale } = await setUp(true);

    await as(t, "bo").mutation(api.library.returnLoan.returnLoan, {
      loanId: await openLoanId(t, x),
    });
    await settle(t, danaSale, "dana", "lena");

    expect(await statusOf(t, danaSale)).toBe("completed");
    expect((await copyRow(t, x)).ownerId).toBe(ids.dana);
  });
});

describe("nobody can ask for or offer a copy out on loan", () => {
  const withRex = async () => {
    const setup = await setUp(false);
    const { t, puzzleAggregateId } = setup;
    const y = await acquire(t, "lena", puzzleAggregateId); // at home
    const r = await acquire(t, "rex", puzzleAggregateId);
    await share(t, "rex", r, { forTrade: true });
    return { ...setup, y, r };
  };

  test("Lena can't offer X in a swap and it isn't listed; once it is back it is", async () => {
    const { t, x, y, r } = await withRex();

    expect(await offerable(t, "lena", r)).toEqual([y.id]);
    expect(await codeOf(proposeSwap(t, "lena", r, x))).toBe("CopyReserved");

    await as(t, "bo").mutation(api.library.returnLoan.returnLoan, {
      loanId: await openLoanId(t, x),
    });
    expect((await offerable(t, "lena", r)).sort()).toEqual([x.id, y.id].sort());
    expect(typeof (await proposeSwap(t, "lena", r, x))).toBe("string");
  });

  test("Rex can't ask for X while it is out, even if it was offered again before this rule", async () => {
    const { t, x } = await withRex();
    // The re-offer SEC-36 allowed: the offers came back while the copy was still lent out.
    await t.run((ctx) =>
      ctx.db.patch(x.id, {
        availability: { forTrade: true, forSale: true, forLend: true },
      }),
    );

    expect(await codeOf(proposeSale(t, "rex", x))).toBe("CopyNotAvailable");
    expect(await codeOf(proposeLend(t, "rex", x))).toBe("CopyNotAvailable");
  });
});
