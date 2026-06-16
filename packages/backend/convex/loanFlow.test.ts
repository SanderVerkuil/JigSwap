import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const asOwner = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_owner" });
const asBorrower = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

// Drain the async dispatch chain (settle -> PossessionTransferred -> openLoan -> LoanOpened ...).
const flush = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = (t: ReturnType<typeof convexTest>) =>
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
  t: ReturnType<typeof convexTest>,
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
