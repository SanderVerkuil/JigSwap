import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A review list is paged; these tests look at what one generous page says.
const FIRST_PAGE = { numItems: 50, cursor: null };

// SEC-34: a catalogue definition that is not approved (pending, rejected, disabled) is disclosed
// only to its submitter or an admin, through every definition read, exactly as getPuzzleById
// already did. Another member gets null, the same answer as for an unknown id.

type Status = "pending" | "approved" | "rejected" | "disabled";

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const submitter = await mkUser("clerk_submitter", "Submitter");
    const other = await mkUser("clerk_other", "Other");
    await mkUser("clerk_admin", "Admin");

    const definitions = {} as Record<Status, Id<"puzzles">>;
    for (const status of [
      "pending",
      "approved",
      "rejected",
      "disabled",
    ] as const) {
      definitions[status] = await ctx.db.insert("puzzles", {
        aggregateId: `def-${status}`,
        title: `Title ${status}`,
        brand: "Ravensburger",
        pieceCount: 1000,
        description: `Hidden description ${status}`,
        tags: [`tag-${status}`],
        difficulty: "hard",
        status,
        submittedBy: submitter,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { submitter, other, definitions };
  });

const asSubmitter = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_submitter" });
const asOther = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_other" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

const definitionView = (
  caller: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  puzzleId: Id<"puzzles">,
) =>
  caller.query(api.library.getPuzzleDefinitionView.getPuzzleDefinitionView, {
    puzzleId,
  });

const byId = (
  caller: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
  puzzleId: Id<"puzzles">,
) => caller.query(api.catalog.getPuzzleById.getPuzzleById, { puzzleId });

describe("non-approved definitions stay private (SEC-34)", () => {
  test.each(["pending", "rejected", "disabled"] as const)(
    "another member gets null for a %s definition",
    async (status) => {
      const t = convexTest(schema, modules);
      const { definitions } = await seed(t);

      expect(await definitionView(asOther(t), definitions[status])).toBeNull();
      expect(await byId(asOther(t), definitions[status])).toBeNull();
    },
  );

  test.each(["pending", "rejected", "disabled"] as const)(
    "the submitter and an admin still get a %s definition",
    async (status) => {
      const t = convexTest(schema, modules);
      const { definitions } = await seed(t);

      for (const caller of [asSubmitter(t), asAdmin(t)]) {
        const view = await definitionView(caller, definitions[status]);
        expect(view?.definition).toMatchObject({
          title: `Title ${status}`,
          description: `Hidden description ${status}`,
          tags: [`tag-${status}`],
        });
        expect((await byId(caller, definitions[status]))?.title).toBe(
          `Title ${status}`,
        );
      }
    },
  );

  test("an approved definition is unchanged for every member", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    for (const caller of [asOther(t), asSubmitter(t), asAdmin(t)]) {
      const view = await definitionView(caller, definitions.approved);
      expect(view?.definition).toMatchObject({
        title: "Title approved",
        description: "Hidden description approved",
        tags: ["tag-approved"],
      });
      expect((await byId(caller, definitions.approved))?.title).toBe(
        "Title approved",
      );
    }
    // Anonymous reads of an approved definition through getPuzzleById stay open.
    expect(
      (
        await t.query(api.catalog.getPuzzleById.getPuzzleById, {
          puzzleId: definitions.approved,
        })
      )?.title,
    ).toBe("Title approved");
  });
});

describe("puzzle reviews of non-approved definitions stay private (SEC-34)", () => {
  // The member reviews list and the review form sit on the definition page, so they apply its gate
  // (canViewDefinition): a hidden definition reads like a missing one.
  const reviewsOf = (
    caller: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
    puzzleId: Id<"puzzles">,
  ) =>
    caller
      .query(api.social.listPuzzleReviews.listPuzzleReviewsPage, {
        puzzleId,
        paginationOpts: FIRST_PAGE,
      })
      .then((result) => result.page);
  const postReview = (
    caller: ReturnType<TestConvex<typeof schema>["withIdentity"]>,
    puzzleId: Id<"puzzles">,
  ) =>
    caller.mutation(api.social.postPuzzleReview.postPuzzleReview, {
      puzzleId,
      rating: 4,
      text: "Lovely",
    });
  const reviewRows = (t: TestConvex<typeof schema>, puzzleId: Id<"puzzles">) =>
    t.run((ctx) =>
      ctx.db
        .query("puzzleReviews")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
        .collect(),
    );

  test.each(["pending", "rejected", "disabled"] as const)(
    "another member neither reads nor posts reviews of a %s definition",
    async (status) => {
      const t = convexTest(schema, modules);
      const { submitter, definitions } = await seed(t);
      await t.run((ctx) =>
        ctx.db.insert("puzzleReviews", {
          puzzleId: definitions[status],
          userId: submitter,
          rating: 5,
          text: "Mine",
          createdAt: 1,
          updatedAt: 1,
        }),
      );

      expect(await reviewsOf(asOther(t), definitions[status])).toEqual([]);
      await expect(postReview(asOther(t), definitions[status])).rejects.toThrow(
        "Puzzle not found",
      );
      expect(await reviewRows(t, definitions[status])).toHaveLength(1);

      // The submitter and an admin, who may open the definition, still read its reviews.
      for (const caller of [asSubmitter(t), asAdmin(t)]) {
        expect(
          (await reviewsOf(caller, definitions[status])).map((r) => r.text),
        ).toEqual(["Mine"]);
      }
    },
  );

  test("the submitter may review their own pending definition", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    await postReview(asSubmitter(t), definitions.pending);
    expect(await reviewRows(t, definitions.pending)).toHaveLength(1);
  });

  test("an approved definition's reviews stay open to every member", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);

    await postReview(asOther(t), definitions.approved);
    expect(
      (await reviewsOf(asSubmitter(t), definitions.approved)).map(
        (r) => r.text,
      ),
    ).toEqual(["Lovely"]);
  });

  test("a review of a deleted definition is refused like a hidden one", async () => {
    const t = convexTest(schema, modules);
    const { definitions } = await seed(t);
    await t.run((ctx) => ctx.db.delete(definitions.approved));

    await expect(postReview(asOther(t), definitions.approved)).rejects.toThrow(
      "Puzzle not found",
    );
    expect(await reviewRows(t, definitions.approved)).toEqual([]);
  });
});
