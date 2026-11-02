import { LIBRARY_TEXT_LIMITS, MAX_SOLVE_NOTES_LENGTH } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// 30 createCollection calls with 400 KB names came to 24 MB for any member opening that profile's
// collections; a 200 KB string also went into a copy's notes, a solve's notes and a category's name.
// Definitions, reviews, comments, bios and goals already refused that much.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const tooLongFor = (max: number) => "x".repeat(max + 1);

type T = TestConvex<typeof schema>;
let t: T;
let puzzleId: Id<"puzzles">;
const copyId = "copy_1";
const definitionId = "definition_1";
const asMe = () => t.withIdentity({ subject: "clerk_me" });

beforeEach(async () => {
  t = convexTest(schema, modules);
  puzzleId = await t.run(async (ctx) => {
    const me = await ctx.db.insert("users", {
      clerkId: "clerk_me",
      email: "me@example.com",
      name: "Me",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Starry Night",
      pieceCount: 1000,
      status: "approved",
      submittedBy: me,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyId,
      puzzleId,
      ownerId: me,
      heldBy: me,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: 1,
      updatedAt: 1,
    });
    return puzzleId;
  });
});

describe("a collection's text", () => {
  const collections = () =>
    t.run((ctx) => ctx.db.query("collections").collect());

  test.each([
    ["name", LIBRARY_TEXT_LIMITS.collectionName],
    ["description", LIBRARY_TEXT_LIMITS.collectionDescription],
    ["personalNotes", LIBRARY_TEXT_LIMITS.collectionNotes],
    ["color", LIBRARY_TEXT_LIMITS.color],
    ["icon", LIBRARY_TEXT_LIMITS.icon],
  ] as const)("a %s over %i characters is refused", async (field, max) => {
    await expect(
      asMe().mutation(api.library.createCollection.createCollection, {
        name: "Favourites",
        [field]: tooLongFor(max),
      }),
    ).rejects.toThrow(/TextTooLong/);
    expect(await collections()).toEqual([]);

    const collectionId = await asMe().mutation(
      api.library.createCollection.createCollection,
      { name: "Favourites" },
    );
    await expect(
      asMe().mutation(api.library.updateCollection.updateCollection, {
        collectionId,
        [field]: tooLongFor(max),
      }),
    ).rejects.toThrow(/TextTooLong/);
    expect((await collections())[0].name).toBe("Favourites");
  });
});

describe("a category's text", () => {
  test.each([
    ["name", LIBRARY_TEXT_LIMITS.categoryName],
    ["description", LIBRARY_TEXT_LIMITS.categoryDescription],
    ["color", LIBRARY_TEXT_LIMITS.color],
  ] as const)("a %s over %i characters is refused", async (field, max) => {
    await expect(
      asMe().mutation(
        api.library.createPersonalCategory.createPersonalCategory,
        {
          name: "Animals",
          [field]: tooLongFor(max),
        },
      ),
    ).rejects.toThrow(/TextTooLong/);
    expect(await t.run((ctx) => ctx.db.query("categories").collect())).toEqual(
      [],
    );
  });
});

describe("notes", () => {
  const tooLong = tooLongFor(LIBRARY_TEXT_LIMITS.copyNotes);

  test("a copy's notes over the bound are refused", async () => {
    await expect(
      asMe().mutation(api.library.acquireCopy.acquireCopy, {
        puzzleDefinitionId: definitionId,
        condition: "good",
        notes: tooLong,
      }),
    ).rejects.toThrow(/TextTooLong/);
    await expect(
      asMe().mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId,
        notes: tooLong,
      }),
    ).rejects.toThrow(/TextTooLong/);
    const rows = await t.run((ctx) => ctx.db.query("ownedPuzzles").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].notes).toBeUndefined();
  });

  test("a solve's notes over the bound are refused", async () => {
    const notes = tooLongFor(MAX_SOLVE_NOTES_LENGTH);
    const startDate = Date.now() - 60 * 60_000;
    await expect(
      asMe().mutation(api.solving.recordCompletion.recordCompletion, {
        puzzleDefinitionId: puzzleId,
        startDate,
        endDate: Date.now(),
        notes,
      }),
    ).rejects.toThrow(/NotesTooLong/);
    await expect(
      asMe().mutation(api.solving.startCompletion.startCompletion, {
        copyId,
        startDate,
        notes,
      }),
    ).rejects.toThrow(/NotesTooLong/);
    expect(await t.run((ctx) => ctx.db.query("completions").collect())).toEqual(
      [],
    );

    const completionId = await asMe().mutation(
      api.solving.startCompletion.startCompletion,
      { copyId, startDate, notes: "Going well" },
    );
    await expect(
      asMe().mutation(api.solving.editCompletion.editCompletion, {
        completionId,
        notes,
      }),
    ).rejects.toThrow(/NotesTooLong/);
    const [row] = await t.run((ctx) => ctx.db.query("completions").collect());
    expect(row.notes).toBe("Going well");
  });
});
