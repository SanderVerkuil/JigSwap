import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");

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
    const history = await asOwner(t).query(
      api.library.getCopyLoanHistory.getCopyLoanHistory,
      { copyId: copy },
    );
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("returned");
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
