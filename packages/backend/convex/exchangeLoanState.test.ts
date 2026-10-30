import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// A settled lend leaves the exchange "completed", but the puzzle is still out with the borrower.
// Each exchange row therefore carries the state of the loan its settlement opened (open, returned
// or recalled), so the web can say "On loan" / "Returned" instead of a misleading "Completed".

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const asOwner = (t: T) => t.withIdentity({ subject: "clerk_owner" });
const asBorrower = (t: T) => t.withIdentity({ subject: "clerk_alice" });

// Drain the async dispatch chain (settle -> PossessionTransferred -> openLoan -> LoanOpened ...).
const flush = async (t: T) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// convex-test stamps rows with the real clock and a whole lend runs within a few milliseconds.
// Step past the current millisecond so consecutive lends of one copy get distinct timestamps.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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
    const owner = await mkUser("clerk_owner");
    const alice = await mkUser("clerk_alice");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Lent Puzzle",
      pieceCount: 1000,
      status: "approved",
      submittedBy: owner,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-agg-loan",
      puzzleId,
      ownerId: owner,
      condition: "good",
      availability: { forTrade: true, forSale: false, forLend: true },
      createdAt: now,
      updatedAt: now,
    });
    return { owner, alice, copy };
  });

// Alice asks to borrow `copy`; the owner accepts and both confirm the handover. Returns the
// exchange's aggregateId (what propose returns and every exchange mutation takes).
const settleLend = async (
  t: T,
  copy: Id<"ownedPuzzles">,
  loanReturnDate?: number,
): Promise<string> => {
  const id = await asBorrower(t).mutation(api.exchange.propose.propose, {
    type: "loan",
    requestedPuzzleId: copy,
    ...(loanReturnDate === undefined ? {} : { loanReturnDate }),
  });
  await asOwner(t).mutation(api.exchange.accept.accept, { exchangeId: id });
  await asBorrower(t).mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId: id },
  );
  await asOwner(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId: id,
  });
  await flush(t);
  return id;
};

const rowFor = async (
  t: T,
  as: (t: T) => ReturnType<T["withIdentity"]>,
  aggregateId: string,
) => {
  const list = await as(t).query(
    api.exchange.getUserExchanges.getUserExchanges,
    {},
  );
  const row = list.find((e) => e.aggregateId === aggregateId);
  if (!row) throw new Error(`exchange ${aggregateId} not in the list`);
  return row;
};

const openLoanId = async (t: T) => {
  const borrowed = await asBorrower(t).query(
    api.library.getBorrowedLoans.getBorrowedLoans,
    {},
  );
  expect(borrowed).toHaveLength(1);
  return borrowed[0].loanId;
};

// The owner offers the copy for lending again (settlement takes it off the market).
const reoffer = (t: T, copy: Id<"ownedPuzzles">) =>
  t.run(async (ctx) => {
    await ctx.db.patch(copy, {
      availability: { forTrade: false, forSale: false, forLend: true },
    });
  });

describe("exchange rows carry the loan a settled lend opened", () => {
  test("a settled lend shows its open loan, with the return date, to both parties", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const returnBy = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const id = await settleLend(t, copy, returnBy);

    for (const as of [asBorrower, asOwner]) {
      const row = await rowFor(t, as, id);
      expect(row.status).toBe("completed");
      expect(row.loan).toEqual({
        status: "open",
        openedAt: expect.any(Number),
        expectedReturn: returnBy,
      });
      expect(row.loan?.openedAt).toBeGreaterThanOrEqual(row.updatedAt);
    }
  });

  test("returning the loan marks the exchange's loan returned, with when", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const id = await settleLend(t, copy);
    await asBorrower(t).mutation(api.library.returnLoan.returnLoan, {
      loanId: await openLoanId(t),
    });
    await flush(t);

    for (const as of [asBorrower, asOwner]) {
      const row = await rowFor(t, as, id);
      expect(row.loan?.status).toBe("returned");
      expect(row.loan?.closedAt).toEqual(expect.any(Number));
      expect(row.loan?.closedAt).toBeGreaterThanOrEqual(
        row.loan?.openedAt ?? Infinity,
      );
      expect(row.loan?.expectedReturn).toBeUndefined();
    }
  });

  test("recalling the loan marks the exchange's loan recalled", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const id = await settleLend(t, copy);
    await asOwner(t).mutation(api.library.recallLoan.recallLoan, {
      loanId: await openLoanId(t),
    });
    await flush(t);

    const row = await rowFor(t, asOwner, id);
    expect(row.loan?.status).toBe("recalled");
    expect(row.loan?.closedAt).toEqual(expect.any(Number));
  });

  test("a later lend of the same copy does not relabel the earlier exchange", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seed(t);
    const first = await settleLend(t, copy);
    await tick();
    await asBorrower(t).mutation(api.library.returnLoan.returnLoan, {
      loanId: await openLoanId(t),
    });
    await flush(t);
    await tick();
    await reoffer(t, copy);
    const second = await settleLend(t, copy);

    const earlier = await rowFor(t, asBorrower, first);
    const later = await rowFor(t, asBorrower, second);
    expect(earlier.loan?.status).toBe("returned");
    expect(later.loan?.status).toBe("open");
    expect(later.loan?.openedAt).toBeGreaterThan(earlier.loan?.openedAt ?? 0);
  });

  test("only a completed lend carries a loan: a pending lend and a completed swap do not", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner, alice } = await seed(t);
    const pending = await asBorrower(t).mutation(api.exchange.propose.propose, {
      type: "loan",
      requestedPuzzleId: copy,
    });
    await asOwner(t).mutation(api.exchange.accept.accept, {
      exchangeId: pending,
    });
    const accepted = await rowFor(t, asBorrower, pending);
    expect(accepted.status).toBe("accepted");
    expect("loan" in accepted).toBe(false);

    // A completed swap of the same copy, followed by a loan of it to the same member: the swap
    // row still carries no loan.
    await t.run(async (ctx) => {
      const settledAt = Date.now() - 10_000;
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-swap",
        initiatorId: alice,
        recipientId: owner,
        type: "trade",
        requestedPuzzleId: copy,
        status: "completed",
        createdAt: settledAt - 1000,
        updatedAt: settledAt,
      });
      await ctx.db.insert("loans", {
        aggregateId: "loan-after-swap",
        copyId: "copy-agg-loan",
        lenderId: owner,
        borrowerId: alice,
        status: "returned",
        openedAt: settledAt + 1000,
        closedAt: settledAt + 2000,
      });
    });
    const swap = await rowFor(t, asBorrower, "exch-swap");
    expect(swap.status).toBe("completed");
    expect("loan" in swap).toBe(false);
  });

  test("a completed lend whose loan never opened shows null, not someone else's later loan", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner, alice } = await seed(t);
    const id = await t.run(async (ctx) => {
      const settledAt = Date.now() - 10_000;
      await ctx.db.insert("exchanges", {
        aggregateId: "exch-legacy-lend",
        initiatorId: alice,
        recipientId: owner,
        type: "loan",
        requestedPuzzleId: copy,
        status: "completed",
        createdAt: settledAt - 1000,
        updatedAt: settledAt,
      });
      // A loan of the same copy that opened later, to another member.
      const carol = await ctx.db.insert("users", {
        clerkId: "clerk_carol",
        email: "carol@example.com",
        name: "clerk_carol",
        isActive: true,
        createdAt: settledAt,
        updatedAt: settledAt,
      });
      await ctx.db.insert("loans", {
        aggregateId: "loan-carol",
        copyId: "copy-agg-loan",
        lenderId: owner,
        borrowerId: carol,
        status: "open",
        openedAt: settledAt + 5000,
      });
      // And an even later loan back to Alice: still not this exchange's loan.
      await ctx.db.insert("loans", {
        aggregateId: "loan-alice-later",
        copyId: "copy-agg-loan",
        lenderId: owner,
        borrowerId: alice,
        status: "open",
        openedAt: settledAt + 6000,
      });
      return "exch-legacy-lend";
    });

    const row = await rowFor(t, asBorrower, id);
    expect(row.loan).toBeNull();
  });
});
