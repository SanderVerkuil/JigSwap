import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// SEC-02 / SEC-36 (P-02 item 10): the read-only integrity audit finds what the old rules let
// through in stored data: settlements that moved a copy away from someone who was no party to the
// deal, copies with more than one accepted exchange, and loans that disagree with who holds the copy.
// Rows are seeded directly; every audit is drained page by page so each finding is reported once.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Name = "ann" | "ben" | "cat" | "dan" | "eve";
type Users = Record<Name, Id<"users">>;
type CopyRef = { id: Id<"ownedPuzzles">; aggregateId: string };

const NOW = 1_790_000_000_000;
const OPEN = { forTrade: true, forSale: true, forLend: true };

const seed = (t: T) =>
  t.run(async (ctx) => {
    const mk = (name: Name) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const users: Users = {
      ann: await mk("ann"),
      ben: await mk("ben"),
      cat: await mk("cat"),
      dan: await mk("dan"),
      eve: await mk("eve"),
    };
    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: crypto.randomUUID(),
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: users.ann,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { users, puzzle };
  });

const insertCopy = async (
  ctx: MutationCtx,
  puzzle: Id<"puzzles">,
  ownerId: Id<"users">,
  heldBy?: Id<"users">,
): Promise<CopyRef> => {
  const aggregateId = crypto.randomUUID();
  const id = await ctx.db.insert("ownedPuzzles", {
    aggregateId,
    puzzleId: puzzle,
    ownerId,
    heldBy,
    condition: "good",
    availability: OPEN,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return { id, aggregateId };
};

type ExchangeSeed = {
  aggregateId?: string;
  initiatorId: Id<"users">;
  recipientId: Id<"users">;
  type: "trade" | "sale" | "loan";
  requestedPuzzleId: Id<"ownedPuzzles">;
  offeredPuzzleId?: Id<"ownedPuzzles">;
  offeredPuzzleOwnerId?: Id<"users">;
  status: "proposed" | "accepted" | "completed";
};

const insertExchange = (ctx: MutationCtx, row: ExchangeSeed) =>
  ctx.db.insert("exchanges", { ...row, createdAt: NOW, updatedAt: NOW });

const insertCustody = (
  ctx: MutationCtx,
  copyId: Id<"ownedPuzzles">,
  exchangeId: string,
  previousOwner: Id<"users">,
  newOwner: Id<"users">,
) =>
  ctx.db.insert("copyCustodyEntries", {
    copyId,
    exchangeId,
    previousOwner,
    newOwner,
    occurredAt: NOW,
  });

const insertLoan = (
  ctx: MutationCtx,
  copyId: string,
  lenderId: Id<"users">,
  borrowerId: Id<"users">,
  status: "open" | "returned" = "open",
) =>
  ctx.db.insert("loans", {
    aggregateId: crypto.randomUUID(),
    copyId,
    lenderId,
    borrowerId,
    status,
    openedAt: NOW,
  });

// Every page until isDone, carrying the cursor.
const drain = async <P extends { isDone: boolean; continueCursor: string }>(
  run: (cursor: string | null) => Promise<P>,
): Promise<P[]> => {
  const pages: P[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await run(cursor);
    pages.push(page);
    if (page.isDone) return pages;
    cursor = page.continueCursor;
  }
};

const audit = internal.exchange.auditExchangeIntegrity;
const opts = (cursor: string | null, numItems = 2) => ({
  paginationOpts: { numItems, cursor },
});

describe("settlementsByNonParty", () => {
  test("reports a custody move whose previous owner was not the party the deal was made with", async () => {
    const t = convexTest(schema, modules);
    const { users: u, puzzle } = await seed(t);
    await t.run(async (ctx) => {
      const x = await insertCopy(ctx, puzzle, u.cat);
      const y = await insertCopy(ctx, puzzle, u.dan);
      const z = await insertCopy(ctx, puzzle, u.eve);
      const w = await insertCopy(ctx, puzzle, u.eve);
      const v = await insertCopy(ctx, puzzle, u.eve);
      const v2 = await insertCopy(ctx, puzzle, u.eve);
      const stray = await insertCopy(ctx, puzzle, u.ben);
      // Ann sold X to Ben: fine.
      await insertExchange(ctx, {
        aggregateId: "sale-ann-ben",
        initiatorId: u.ben,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: x.id,
        status: "completed",
      });
      await insertCustody(ctx, x.id, "sale-ann-ben", u.ann, u.ben);
      // Cat's stale request to Ann settled after X was Ben's: X left Ben, who was no party.
      await insertExchange(ctx, {
        aggregateId: "sale-ann-cat",
        initiatorId: u.cat,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: x.id,
        status: "completed",
      });
      await insertCustody(ctx, x.id, "sale-ann-cat", u.ben, u.cat);
      // Dan swapped his Z for Eve's Y, the offered owner recorded: fine on both sides.
      await insertExchange(ctx, {
        aggregateId: "swap-ok",
        initiatorId: u.dan,
        recipientId: u.eve,
        type: "trade",
        requestedPuzzleId: y.id,
        offeredPuzzleId: z.id,
        offeredPuzzleOwnerId: u.dan,
        status: "completed",
      });
      await insertCustody(ctx, y.id, "swap-ok", u.eve, u.dan);
      await insertCustody(ctx, z.id, "swap-ok", u.dan, u.eve);
      // Dan offered housemate Cat's W (recorded), but W moved out of Ben's library.
      await insertExchange(ctx, {
        aggregateId: "swap-recorded",
        initiatorId: u.dan,
        recipientId: u.eve,
        type: "trade",
        requestedPuzzleId: y.id,
        offeredPuzzleId: w.id,
        offeredPuzzleOwnerId: u.cat,
        status: "completed",
      });
      await insertCustody(ctx, w.id, "swap-recorded", u.ben, u.eve);
      // Legacy swaps (no recorded owner): checked against the initiator.
      await insertExchange(ctx, {
        aggregateId: "swap-legacy",
        initiatorId: u.dan,
        recipientId: u.eve,
        type: "trade",
        requestedPuzzleId: y.id,
        offeredPuzzleId: v.id,
        status: "completed",
      });
      await insertCustody(ctx, v.id, "swap-legacy", u.cat, u.eve);
      await insertExchange(ctx, {
        aggregateId: "swap-legacy-ok",
        initiatorId: u.dan,
        recipientId: u.eve,
        type: "trade",
        requestedPuzzleId: y.id,
        offeredPuzzleId: v2.id,
        status: "completed",
      });
      await insertCustody(ctx, v2.id, "swap-legacy-ok", u.dan, u.eve);
      // A custody row the audit can't tie to its deal.
      await insertCustody(ctx, x.id, "no-such-exchange", u.ben, u.cat);
      await insertCustody(ctx, stray.id, "sale-ann-ben", u.ann, u.ben);
    });

    const pages = await drain((cursor) =>
      t.query(audit.settlementsByNonParty, opts(cursor)),
    );
    const findings = pages.flatMap((page) => page.findings);
    expect(pages.reduce((n, page) => n + page.scanned, 0)).toBe(9);
    expect(
      findings
        .map((f) => [f.reason, f.exchangeId, f.expectedPreviousOwner ?? null])
        .sort(),
    ).toEqual(
      [
        ["requestedNotFromRecipient", "sale-ann-cat", u.ann],
        ["offeredNotFromRecordedOwner", "swap-recorded", u.cat],
        ["offeredNotFromInitiator", "swap-legacy", u.dan],
        ["exchangeMissing", "no-such-exchange", null],
        ["copyNotInExchange", "sale-ann-ben", null],
      ].sort(),
    );
    const stale = findings.find((f) => f.exchangeId === "sale-ann-cat");
    expect(stale).toMatchObject({ previousOwner: u.ben, newOwner: u.cat });
  });

  test("clamps the page size to 1..100", async () => {
    const t = convexTest(schema, modules);
    const { users: u, puzzle } = await seed(t);
    await t.run(async (ctx) => {
      const x = await insertCopy(ctx, puzzle, u.ann);
      for (let i = 0; i < 105; i++) {
        await insertCustody(ctx, x.id, `sale-${i}`, u.ann, u.ben);
      }
    });
    const big = await t.query(audit.settlementsByNonParty, opts(null, 1000));
    expect(big.scanned).toBe(100);
    expect(big.isDone).toBe(false);
    const tiny = await t.query(audit.settlementsByNonParty, opts(null, 0));
    expect(tiny.scanned).toBe(1);
  });
});

describe("acceptedDealConflicts", () => {
  test("reports each copy with more than one accepted exchange once, saying which can still settle", async () => {
    const t = convexTest(schema, modules);
    const { users: u, puzzle } = await seed(t);
    await t.run(async (ctx) => {
      const x = await insertCopy(ctx, puzzle, u.ann);
      const y = await insertCopy(ctx, puzzle, u.ann);
      const z = await insertCopy(ctx, puzzle, u.ann);
      const q = await insertCopy(ctx, puzzle, u.ann);
      const r = await insertCopy(ctx, puzzle, u.ann);
      const p = await insertCopy(ctx, puzzle, u.dan);
      // Ann accepted two deals on X: both could settle.
      for (const [aggregateId, initiatorId, type] of [
        ["x-sale-ben", u.ben, "sale"],
        ["x-lend-cat", u.cat, "loan"],
      ] as const) {
        await insertExchange(ctx, {
          aggregateId,
          initiatorId,
          recipientId: u.ann,
          type,
          requestedPuzzleId: x.id,
          status: "accepted",
        });
      }
      // Y: Ann's live deal, plus a stale one proposed to Ben, who no longer owns Y.
      await insertExchange(ctx, {
        aggregateId: "y-live",
        initiatorId: u.dan,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: y.id,
        status: "accepted",
      });
      await insertExchange(ctx, {
        aggregateId: "y-stale",
        initiatorId: u.eve,
        recipientId: u.ben,
        type: "sale",
        requestedPuzzleId: y.id,
        status: "accepted",
      });
      // Z: one accepted and one proposed is not a conflict.
      await insertExchange(ctx, {
        aggregateId: "z-accepted",
        initiatorId: u.ben,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: z.id,
        status: "accepted",
      });
      await insertExchange(ctx, {
        aggregateId: "z-proposed",
        initiatorId: u.cat,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: z.id,
        status: "proposed",
      });
      // Q: a legacy row without an aggregateId can't be acted on and is left out.
      await insertExchange(ctx, {
        aggregateId: "q-accepted",
        initiatorId: u.ben,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: q.id,
        status: "accepted",
      });
      await insertExchange(ctx, {
        initiatorId: u.cat,
        recipientId: u.ann,
        type: "sale",
        requestedPuzzleId: q.id,
        status: "accepted",
      });
      // P: Dan offered it in an accepted swap for Ann's R, and accepted Eve's purchase of it.
      await insertExchange(ctx, {
        aggregateId: "p-swap",
        initiatorId: u.dan,
        recipientId: u.ann,
        type: "trade",
        requestedPuzzleId: r.id,
        offeredPuzzleId: p.id,
        offeredPuzzleOwnerId: u.dan,
        status: "accepted",
      });
      await insertExchange(ctx, {
        aggregateId: "p-sale",
        initiatorId: u.eve,
        recipientId: u.dan,
        type: "sale",
        requestedPuzzleId: p.id,
        status: "accepted",
      });
    });

    const pages = await drain((cursor) =>
      t.query(audit.acceptedDealConflicts, opts(cursor, 1)),
    );
    const conflicts = pages.flatMap((page) => page.conflicts);
    expect(
      conflicts
        .map((c) =>
          c.exchanges
            .map((e) => `${e.exchangeId}:${e.canStillSettle}`)
            .join(" "),
        )
        .sort(),
    ).toEqual([
      "p-swap:true p-sale:true",
      "x-sale-ben:true x-lend-cat:true",
      "y-live:true y-stale:false",
    ]);
  });
});

describe("loanConflicts", () => {
  test("reports open loans that disagree with the copy's owner or holder, or share a copy", async () => {
    const t = convexTest(schema, modules);
    const { users: u, puzzle } = await seed(t);
    const loans = await t.run(async (ctx) => {
      const atBen = await insertCopy(ctx, puzzle, u.ann, u.ben);
      const atHome = await insertCopy(ctx, puzzle, u.ann);
      const twice = await insertCopy(ctx, puzzle, u.ann, u.cat);
      const sold = await insertCopy(ctx, puzzle, u.dan, u.ben);
      return {
        fine: await insertLoan(ctx, atBen.aggregateId, u.ann, u.ben),
        notHeld: await insertLoan(ctx, atHome.aggregateId, u.ann, u.ben),
        closed: await insertLoan(
          ctx,
          atHome.aggregateId,
          u.ann,
          u.cat,
          "returned",
        ),
        twiceBen: await insertLoan(ctx, twice.aggregateId, u.ann, u.ben),
        twiceCat: await insertLoan(ctx, twice.aggregateId, u.ann, u.cat),
        formerOwner: await insertLoan(ctx, sold.aggregateId, u.ann, u.ben),
        gone: await insertLoan(ctx, "no-such-copy", u.ann, u.ben),
      };
    });

    const pages = await drain((cursor) =>
      t.query(audit.loanConflicts, opts(cursor)),
    );
    const byLoan = new Map(
      pages
        .flatMap((page) => page.findings)
        .map((f) => [f.loanRowId, [...f.reasons].sort()]),
    );
    expect(byLoan).toEqual(
      new Map([
        [loans.notHeld, ["borrowerNotHolding"]],
        [loans.twiceBen, ["borrowerNotHolding", "multipleOpenLoans"]],
        [loans.twiceCat, ["multipleOpenLoans"]],
        [loans.formerOwner, ["lenderNotOwner"]],
        [loans.gone, ["copyMissing"]],
      ]),
    );
  });
});

describe("possessionWithoutLoan", () => {
  test("reports a copy held by someone else with no open loan to them", async () => {
    const t = convexTest(schema, modules);
    const { users: u, puzzle } = await seed(t);
    const copies = await t.run(async (ctx) => {
      const lent = await insertCopy(ctx, puzzle, u.ann, u.ben);
      await insertLoan(ctx, lent.aggregateId, u.ann, u.ben);
      const returned = await insertCopy(ctx, puzzle, u.ann, u.ben);
      await insertLoan(ctx, returned.aggregateId, u.ann, u.ben, "returned");
      await insertCopy(ctx, puzzle, u.ann, u.ann);
      await insertCopy(ctx, puzzle, u.ann);
      const elsewhere = await insertCopy(ctx, puzzle, u.ann, u.cat);
      await insertLoan(ctx, elsewhere.aggregateId, u.ann, u.ben);
      return { returned, elsewhere };
    });

    const pages = await drain((cursor) =>
      t.query(audit.possessionWithoutLoan, opts(cursor)),
    );
    expect(pages.reduce((n, page) => n + page.scanned, 0)).toBe(5);
    expect(
      pages
        .flatMap((page) => page.findings)
        .map((f) => [f.copyId, f.heldBy])
        .sort(),
    ).toEqual(
      [
        [copies.returned.id, u.ben],
        [copies.elsewhere.id, u.cat],
      ].sort(),
    );
  });
});
