import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Every public mutation is directly callable, and v.number() takes NaN, Infinity, negatives and
// 1e300 alike. Before the domain bounded them these were stored and shown to other members ("-1
// missing pieces", a solve dated NaN). Each case goes through the public function and checks the
// refusal and that nothing was written.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const DAY = 24 * 60 * 60_000;

// What a client can send for a date; new Date() makes each of them impossible.
const BAD_DATES = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  1e30,
  -1e30,
  -1e15,
  Number.MAX_VALUE,
];

type T = TestConvex<typeof schema>;
let t: T;
let puzzleId: Id<"puzzles">;
let copyAggregateId: string;
let puzzleDefinitionAggregateId: string;
const asMe = () => t.withIdentity({ subject: "clerk_me" });

beforeEach(async () => {
  t = convexTest(schema, modules);
  ({ puzzleId, copyAggregateId, puzzleDefinitionAggregateId } = await t.run(
    async (ctx) => {
      const me = await ctx.db.insert("users", {
        clerkId: "clerk_me",
        email: "me@example.com",
        name: "Me",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const puzzleId = await ctx.db.insert("puzzles", {
        title: "Starry Night",
        pieceCount: 1000,
        status: "approved",
        aggregateId: "definition_1",
        submittedBy: me,
        createdAt: 1,
        updatedAt: 1,
      });
      const copyAggregateId = "copy_1";
      await ctx.db.insert("ownedPuzzles", {
        aggregateId: copyAggregateId,
        puzzleId,
        ownerId: me,
        heldBy: me,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: 1,
        updatedAt: 1,
      });
      return {
        puzzleId,
        copyAggregateId,
        puzzleDefinitionAggregateId: "definition_1",
      };
    },
  ));
});

const completions = () => t.run((ctx) => ctx.db.query("completions").collect());

describe("a solve's dates", () => {
  test.each(BAD_DATES)(
    "recordCompletion refuses a date of %p",
    async (date) => {
      await expect(
        asMe().mutation(api.solving.recordCompletion.recordCompletion, {
          puzzleDefinitionId: puzzleId,
          startDate: date,
          endDate: Date.now(),
        }),
      ).rejects.toThrow();
      await expect(
        asMe().mutation(api.solving.recordCompletion.recordCompletion, {
          puzzleDefinitionId: puzzleId,
          startDate: date,
        }),
      ).rejects.toThrow(/InvalidSolveDate/);
      expect(await completions()).toEqual([]);
    },
  );

  test.each(BAD_DATES)(
    "startCompletion refuses a start of %p",
    async (date) => {
      await expect(
        asMe().mutation(api.solving.startCompletion.startCompletion, {
          copyId: copyAggregateId,
          startDate: date,
        }),
      ).rejects.toThrow(/InvalidSolveDate/);
      expect(await completions()).toEqual([]);
    },
  );

  test.each(BAD_DATES)(
    "recordPastCompletions refuses a day of %p",
    async (date) => {
      await expect(
        asMe().mutation(
          api.solving.recordPastCompletions.recordPastCompletions,
          {
            items: [{ copyId: copyAggregateId, datePrecision: "day", date }],
          },
        ),
      ).rejects.toThrow(/InvalidSolveDate/);
      expect(await completions()).toEqual([]);
    },
  );

  test.each(BAD_DATES)(
    "finishCompletion and editCompletion refuse %p",
    async (date) => {
      const startDate = Date.now() - DAY;
      const completionId = await asMe().mutation(
        api.solving.startCompletion.startCompletion,
        { copyId: copyAggregateId, startDate },
      );
      await expect(
        asMe().mutation(api.solving.finishCompletion.finishCompletion, {
          completionId,
          endDate: date,
        }),
      ).rejects.toThrow(/InvalidSolveDate/);
      await expect(
        asMe().mutation(api.solving.editCompletion.editCompletion, {
          completionId,
          startDate: date,
        }),
      ).rejects.toThrow(/InvalidSolveDate/);
      const [row] = await completions();
      expect(row.startDate).toBe(startDate);
      expect(row.isCompleted).toBe(false);
    },
  );

  test("an ordinary solve still logs", async () => {
    await asMe().mutation(api.solving.recordCompletion.recordCompletion, {
      puzzleDefinitionId: puzzleId,
      startDate: Date.now() - DAY,
      endDate: Date.now(),
    });
    expect(await completions()).toHaveLength(1);
  });
});

describe("a goal's numbers", () => {
  const goal = { title: "Solve more", targetCompletions: 3 };
  const goals = () => t.run((ctx) => ctx.db.query("goals").collect());

  test.each([1e300, Number.MAX_VALUE, 100_001])(
    "createGoal refuses a target of %p",
    async (targetCompletions) => {
      await expect(
        asMe().mutation(api.solving.createGoal.createGoal, {
          ...goal,
          targetCompletions,
        }),
      ).rejects.toThrow(/InvalidGoalTarget/);
      expect(await goals()).toEqual([]);
    },
  );

  test.each(BAD_DATES)("createGoal refuses a period with %p", async (date) => {
    await expect(
      asMe().mutation(api.solving.createGoal.createGoal, {
        ...goal,
        startDate: date,
      }),
    ).rejects.toThrow(/InvalidGoalPeriod/);
    await expect(
      asMe().mutation(api.solving.createGoal.createGoal, {
        ...goal,
        targetDate: date,
      }),
    ).rejects.toThrow(/InvalidGoalPeriod/);
    expect(await goals()).toEqual([]);
  });

  test("updateGoal holds to the same bounds", async () => {
    const goalId = await asMe().mutation(
      api.solving.createGoal.createGoal,
      goal,
    );
    await expect(
      asMe().mutation(api.solving.updateGoal.updateGoal, {
        goalId,
        ...goal,
        targetCompletions: 1e300,
      }),
    ).rejects.toThrow(/InvalidGoalTarget/);
    await expect(
      asMe().mutation(api.solving.updateGoal.updateGoal, {
        goalId,
        ...goal,
        targetDate: 8e15,
      }),
    ).rejects.toThrow(/InvalidGoalPeriod/);
    const [row] = await goals();
    expect(row.targetCompletions).toBe(3);
  });
});

describe("a copy's numbers", () => {
  const BAD_COUNTS = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1e300,
    100_001,
  ];
  const copyRows = () => t.run((ctx) => ctx.db.query("ownedPuzzles").collect());

  test.each(BAD_COUNTS)(
    "acquireCopy refuses %p missing pieces",
    async (count) => {
      await expect(
        asMe().mutation(api.library.acquireCopy.acquireCopy, {
          puzzleDefinitionId: puzzleDefinitionAggregateId,
          condition: "good",
          missingPiecesCount: count,
        }),
      ).rejects.toThrow(/InvalidMissingPieces/);
      expect(await copyRows()).toHaveLength(1);
    },
  );

  test.each(BAD_COUNTS)(
    "updateCopyDetails refuses %p missing pieces",
    async (count) => {
      await expect(
        asMe().mutation(api.library.updateCopyDetails.updateCopyDetails, {
          copyId: copyAggregateId,
          missingPiecesCount: count,
        }),
      ).rejects.toThrow(/InvalidMissingPieces/);
      const [row] = await copyRows();
      expect(row.missingPiecesCount).toBeUndefined();
    },
  );

  test.each(BAD_DATES)(
    "acquireCopy refuses an acquired date of %p",
    async (date) => {
      await expect(
        asMe().mutation(api.library.acquireCopy.acquireCopy, {
          puzzleDefinitionId: puzzleDefinitionAggregateId,
          condition: "good",
          acquisition: { date },
        }),
      ).rejects.toThrow(/InvalidAcquisitionDate/);
    },
  );

  test.each([1e300, Number.MAX_VALUE, 100_000_001, Number.NaN, -1, 1.5])(
    "a price of %p cents is refused on a sale and on an acquisition",
    async (amountCents) => {
      await expect(
        asMe().mutation(api.library.updateCopySharing.updateCopySharing, {
          copyId: copyAggregateId,
          forSale: true,
          salePrice: { amountCents, currency: "EUR" },
        }),
      ).rejects.toThrow(/InvalidPrice/);
      await expect(
        asMe().mutation(api.library.acquireCopy.acquireCopy, {
          puzzleDefinitionId: puzzleDefinitionAggregateId,
          condition: "good",
          acquisition: { price: { amountCents, currency: "EUR" } },
        }),
      ).rejects.toThrow(/InvalidPrice/);
      const rows = await copyRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].salePrice).toBeUndefined();
    },
  );

  test("ordinary numbers still save", async () => {
    await asMe().mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: copyAggregateId,
      missingPiecesCount: 2,
    });
    const [row] = await copyRows();
    expect(row.missingPiecesCount).toBe(2);
  });
});

describe("an exchange's terms", () => {
  const seedOtherCopy = () =>
    t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", {
        clerkId: "clerk_owner",
        email: "owner@example.com",
        name: "Owner",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("profiles", {
        aggregateId: "profile_owner",
        memberId: owner,
        visibility: "public",
        updatedAt: 1,
      });
      return ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy_owner",
        puzzleId,
        ownerId: owner,
        heldBy: owner,
        condition: "good",
        availability: { forTrade: false, forSale: true, forLend: true },
        isOpen: true,
        listedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
  const exchanges = () => t.run((ctx) => ctx.db.query("exchanges").collect());

  test.each([1e300, Number.MAX_VALUE, 100_000_001, Number.NaN, -1, 1.5])(
    "propose refuses a price of %p cents",
    async (salePrice) => {
      const requestedPuzzleId = await seedOtherCopy();
      await expect(
        asMe().mutation(api.exchange.propose.propose, {
          type: "sale",
          requestedPuzzleId,
          salePrice,
        }),
      ).rejects.toThrow(/MissingTerms/);
      expect(await exchanges()).toEqual([]);
    },
  );

  test.each([
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1e30,
    -1e15,
    Date.now() + 11 * 365 * DAY,
    1,
  ])("propose refuses a return date of %p", async (loanReturnDate) => {
    const requestedPuzzleId = await seedOtherCopy();
    await expect(
      asMe().mutation(api.exchange.propose.propose, {
        type: "loan",
        requestedPuzzleId,
        loanReturnDate,
      }),
    ).rejects.toThrow(/MissingTerms/);
    expect(await exchanges()).toEqual([]);
  });

  test("a stored price past the bound still reads back as stored", async () => {
    const requestedPuzzleId = await seedOtherCopy();
    const exchangeId = await asMe().mutation(api.exchange.propose.propose, {
      type: "sale",
      requestedPuzzleId,
      salePrice: 1500,
    });
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("exchanges").collect();
      await ctx.db.patch(row._id, {
        salePrice: { amount: 1e300, currency: "EUR" },
      });
    });
    await asMe().mutation(api.exchange.cancel.cancel, { exchangeId });
    const [row] = await exchanges();
    expect(row.status).toBe("cancelled");
    expect(row.salePrice?.amount).toBe(1e300);
  });
});
