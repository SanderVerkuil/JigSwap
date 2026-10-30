import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const asOwner = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_owner" });
const asBorrower = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });

// Drain the async dispatch chain (settle -> PossessionTransferred -> openLoan -> LoanOpened ...).
const flush = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = (t: TestConvex<typeof schema>) =>
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
      availability: { forTrade: false, forSale: false, forLend: true },
      createdAt: now,
      updatedAt: now,
    });
    return { owner, alice, copy };
  });

// Alice borrows `copy` from the owner via a settled lend.
const settleLend = async (
  t: TestConvex<typeof schema>,
  copy: Id<"ownedPuzzles">,
  owner: Id<"users">,
) => {
  const id = await asBorrower(t).mutation(api.exchange.propose.propose, {
    recipientId: owner,
    type: "loan",
    requestedPuzzleId: copy,
  });
  await asOwner(t).mutation(api.exchange.accept.accept, { exchangeId: id });
  await asBorrower(t).mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId: id },
  );
  await asOwner(t).mutation(api.exchange.confirmCompletion.confirmCompletion, {
    exchangeId: id,
  });
};

describe("loan lifecycle", () => {
  test("a settled lend opens a loan and moves possession to the borrower", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner, alice } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);

    const row = await t.run(async (ctx) => ctx.db.get(copy));
    expect(row?.ownerId).toBe(owner); // ownership unchanged
    expect(row?.heldBy).toBe(alice); // possession moved to the borrower

    const borrowed = await asBorrower(t).query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    expect(borrowed).toHaveLength(1);
    expect(borrowed[0].borrower?.name).toBe("clerk_alice");
    expect(borrowed[0].lender?.name).toBe("clerk_owner");

    const lentOut = await asOwner(t).query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    expect(lentOut).toHaveLength(1);
  });

  test("both loan lists carry the copy's cover as a URL (null without one)", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);

    // No cover photo and no box art yet: null, so the web shows its placeholder.
    const before = await asBorrower(t).query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    expect(before[0].coverUrl).toBeNull();

    const boxArt = await t.run(async (ctx) => {
      const row = await ctx.db.get(copy);
      const blob = await ctx.storage.store(
        new Blob(["box-art"], { type: "image/png" }),
      );
      await ctx.db.patch(row!.puzzleId, { image: blob });
      return blob;
    });
    const borrowed = await asBorrower(t).query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    const lentOut = await asOwner(t).query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    for (const loan of [borrowed[0], lentOut[0]]) {
      expect(loan.coverUrl).toMatch(/^https?:\/\//);
      expect(loan.coverUrl).not.toContain(boxArt);
    }
  });

  test("the borrower returns the loan -> possession back to the owner, no open loans", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);

    const borrowed = await asBorrower(t).query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    await asBorrower(t).mutation(api.library.returnLoan.returnLoan, {
      loanId: borrowed[0].loanId,
    });
    await flush(t);

    expect((await t.run(async (ctx) => ctx.db.get(copy)))?.heldBy).toBe(owner);
    expect(
      await asBorrower(t).query(
        api.library.getBorrowedLoans.getBorrowedLoans,
        {},
      ),
    ).toHaveLength(0);
    // The history read is auth-gated.
    await expect(
      t.query(api.library.getCopyLoanHistory.getCopyLoanHistory, {
        copyId: copy,
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    const history = await asOwner(t).query(
      api.library.getCopyLoanHistory.getCopyLoanHistory,
      { copyId: copy },
    );
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("returned");
    // Both parties are privacy-projected; here both have public (default) profiles so they reveal.
    expect(history[0].lender.anonymous).toBe(false);
    if (!history[0].lender.anonymous) {
      expect(history[0].lender.member.name).toBe("clerk_owner");
    }
    expect(history[0].borrower.anonymous).toBe(false);
    if (!history[0].borrower.anonymous) {
      expect(history[0].borrower.member.name).toBe("clerk_alice");
    }
  });

  test("getCopyLoanHistory returns [] for a non-owner when the copy is unreachable", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);

    // Make the owner private and the copy closed -> a non-owner stranger cannot reach it.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "clerk_stranger",
        email: "stranger@example.com",
        name: "clerk_stranger",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("profiles", {
        memberId: owner,
        displayName: "clerk_owner",
        visibility: "private",
        updatedAt: Date.now(),
      });
      await ctx.db.patch(copy, {
        availability: { forTrade: false, forSale: false, forLend: false },
      });
    });

    const history = await t
      .withIdentity({ subject: "clerk_stranger" })
      .query(api.library.getCopyLoanHistory.getCopyLoanHistory, {
        copyId: copy,
      });
    expect(history).toEqual([]);

    // The owner still sees the full history.
    const ownerHistory = await asOwner(t).query(
      api.library.getCopyLoanHistory.getCopyLoanHistory,
      { copyId: copy },
    );
    expect(ownerHistory).toHaveLength(1);
  });

  test("the owner recalls the loan -> possession back to the owner", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);

    const lentOut = await asOwner(t).query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    await asOwner(t).mutation(api.library.recallLoan.recallLoan, {
      loanId: lentOut[0].loanId,
    });
    await flush(t);

    expect((await t.run(async (ctx) => ctx.db.get(copy)))?.heldBy).toBe(owner);
  });

  test("a non-borrower cannot return and a non-owner cannot recall", async () => {
    const t = convexTest(schema, modules);
    const { copy, owner } = await seed(t);
    await settleLend(t, copy, owner);
    await flush(t);
    const lentOut = await asOwner(t).query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    const loanId = lentOut[0].loanId;

    // The owner is not the borrower → cannot return.
    await expect(
      asOwner(t).mutation(api.library.returnLoan.returnLoan, { loanId }),
    ).rejects.toThrow();
    // The borrower is not the owner → cannot recall.
    await expect(
      asBorrower(t).mutation(api.library.recallLoan.recallLoan, { loanId }),
    ).rejects.toThrow();
  });
});

// SEC-36: one loan per copy. A copy out on loan is never lent again until it is back; closing a
// loan gives possession back only while that loan's borrower holds the copy; and a transfer ends
// any loan still open on the copy. The settlement events are recorded directly, as an event written
// before the exchange-side checks (or in a race between two old deals) would reach the dispatcher.
describe("one open loan per copy", () => {
  const asCarl = (t: TestConvex<typeof schema>) =>
    t.withIdentity({ subject: "clerk_carl" });

  // Alice holds the copy on a settled lend; Carl is a third member.
  const setUp = async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const carl = await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_carl",
        email: "clerk_carl@example.com",
        name: "clerk_carl",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await settleLend(t, ids.copy, ids.owner);
    await flush(t);
    return { t, ...ids, carl };
  };

  const loansOfCopy = (t: TestConvex<typeof schema>) =>
    t.run((ctx) =>
      ctx.db
        .query("loans")
        .withIndex("by_copy", (q) => q.eq("copyId", "copy-agg-loan"))
        .collect(),
    );

  const recordAndDispatch = async (
    t: TestConvex<typeof schema>,
    name: "OwnershipTransferred" | "PossessionTransferred",
    payload: Record<string, unknown>,
  ) => {
    const eventId = await t.run((ctx) =>
      ctx.db.insert("domainEvents", {
        name,
        payload: { exchangeId: "x-stale", ...payload },
        occurredAt: Date.now(),
        context: "exchange",
      }),
    );
    // A refusal is logged as a dispatch error on purpose; keep the test output clean.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await t.mutation(internal.events.dispatch.dispatch, { eventId });
    } finally {
      quiet.mockRestore();
    }
    return t.run((ctx) => ctx.db.get(eventId));
  };

  // An older loan to Carl left open beside Alice's current one (rows from before one loan per copy).
  const insertOlderLoanToCarl = (
    t: TestConvex<typeof schema>,
    owner: Id<"users">,
    carl: Id<"users">,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("loans", {
        aggregateId: "loan-older-carl",
        copyId: "copy-agg-loan",
        lenderId: owner,
        borrowerId: carl,
        status: "open",
        openedAt: Date.now() - 60_000,
      }),
    );

  test("a second loan never opens while the copy is out: refused and recorded, Alice keeps it", async () => {
    const { t, owner, alice, carl, copy } = await setUp();

    const event = await recordAndDispatch(t, "PossessionTransferred", {
      copyId: copy,
      borrower: carl,
      lender: owner,
    });

    expect(event?.failedHandlers).toEqual(["openLoan"]);
    expect(event?.lastError?.message).toContain("AlreadyLentOut");
    const loans = await loansOfCopy(t);
    expect(loans).toHaveLength(1);
    expect(loans[0].borrowerId).toBe(alice);
    expect((await t.run((ctx) => ctx.db.get(copy)))?.heldBy).toBe(alice);
  });

  test("Carl returning an older loan closes it and leaves the copy with Alice", async () => {
    const { t, owner, alice, carl, copy } = await setUp();
    const older = await insertOlderLoanToCarl(t, owner, carl);

    await asCarl(t).mutation(api.library.returnLoan.returnLoan, {
      loanId: "loan-older-carl",
    });

    expect((await t.run((ctx) => ctx.db.get(older)))?.status).toBe("returned");
    expect((await t.run((ctx) => ctx.db.get(copy)))?.heldBy).toBe(alice);
    const borrowed = await asBorrower(t).query(
      api.library.getBorrowedLoans.getBorrowedLoans,
      {},
    );
    expect(borrowed).toHaveLength(1);
  });

  test("the owner recalling an older loan closes it and leaves the copy with Alice", async () => {
    const { t, owner, alice, carl, copy } = await setUp();
    const older = await insertOlderLoanToCarl(t, owner, carl);

    await asOwner(t).mutation(api.library.recallLoan.recallLoan, {
      loanId: "loan-older-carl",
    });

    expect((await t.run((ctx) => ctx.db.get(older)))?.status).toBe("recalled");
    expect((await t.run((ctx) => ctx.db.get(copy)))?.heldBy).toBe(alice);
  });

  test("a transfer of a lent-out copy ends the loan with the move", async () => {
    const { t, owner, carl, copy } = await setUp();

    const event = await recordAndDispatch(t, "OwnershipTransferred", {
      copyId: copy,
      newOwner: carl,
      expectedPreviousOwner: owner,
    });

    expect(event?.processedAt).toBeDefined();
    expect(event?.failedHandlers).toBeUndefined();
    const row = await t.run((ctx) => ctx.db.get(copy));
    expect(row?.ownerId).toBe(carl);
    expect(row?.heldBy).toBe(carl);
    const loans = await loansOfCopy(t);
    expect(loans.map((l) => l.status)).toEqual(["recalled"]);
    expect(loans[0].closedAt).toEqual(expect.any(Number));
    expect(
      await asBorrower(t).query(
        api.library.getBorrowedLoans.getBorrowedLoans,
        {},
      ),
    ).toHaveLength(0);
  });
});
