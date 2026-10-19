import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
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
