import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-34: a copy of a definition that is not approved (pending, rejected, disabled) can still reach
// other members, e.g. a submitter who self-acquired their own pending submission and offers it.
// Other members then see only the facts the copy itself carries (its snapshot: title, brand,
// pieces) and never the definition's unmoderated catalogue text (description, publisher,
// difficulty, category, tags). The owner's own library views keep the full facts.

const OPEN = { forTrade: true, forSale: false, forLend: false };
const HIDDEN = ["pending", "rejected", "disabled"] as const;
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
    // Both profiles default to public (no profiles row), so every open copy is reachable.
    const submitter = await mkUser("clerk_submitter", "Submitter");
    const other = await mkUser("clerk_other", "Other");

    const category = await ctx.db.insert("adminCategories", {
      name: { en: "Landscapes", nl: "Landschappen" },
      isActive: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    });

    const definitions = {} as Record<Status, Id<"puzzles">>;
    const copies = {} as Record<Status, Id<"ownedPuzzles">>;
    let at = now;
    for (const status of [
      "pending",
      "approved",
      "rejected",
      "disabled",
    ] as const) {
      definitions[status] = await ctx.db.insert("puzzles", {
        aggregateId: `def-${status}`,
        title: `Row title ${status}`,
        brand: "Ravensburger",
        publisher: `Publisher ${status}`,
        pieceCount: 1000,
        description: `secretword ${status}`,
        tags: [`hiddentag-${status}`],
        difficulty: "hard",
        category,
        status,
        submittedBy: submitter,
        createdAt: now,
        updatedAt: now,
      });
      at += 1;
      copies[status] = await ctx.db.insert("ownedPuzzles", {
        aggregateId: `copy-${status}`,
        puzzleId: definitions[status],
        puzzleDefinitionId: `def-${status}`,
        ownerId: submitter,
        condition: "good",
        availability: OPEN,
        snapshot: {
          title: `Snapshot title ${status}`,
          brand: "Ravensburger",
          pieceCount: 500,
        },
        createdAt: at,
        updatedAt: at,
      });
    }
    return { submitter, other, category, definitions, copies };
  });

const asOther = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_other" });
const asSubmitter = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_submitter" });

type JoinedPuzzle = {
  title: string;
  brand?: string;
  pieceCount: number;
  description?: string;
  publisher?: string;
  difficulty?: string;
  category?: string;
  tags?: string[];
} | null;

const expectSnapshotOnly = (puzzle: JoinedPuzzle, status: Status) => {
  expect(puzzle).toMatchObject({
    title: `Snapshot title ${status}`,
    brand: "Ravensburger",
    pieceCount: 500,
  });
  expect(puzzle?.description).toBeUndefined();
  expect(puzzle?.publisher).toBeUndefined();
  expect(puzzle?.difficulty).toBeUndefined();
  expect(puzzle?.category).toBeUndefined();
  expect(puzzle?.tags).toBeUndefined();
};

const expectFullFacts = (puzzle: JoinedPuzzle, status: Status) => {
  expect(puzzle).toMatchObject({
    title: `Row title ${status}`,
    description: `secretword ${status}`,
    publisher: `Publisher ${status}`,
    difficulty: "hard",
    tags: [`hiddentag-${status}`],
  });
};

const browse = (
  t: TestConvex<typeof schema>,
  args: Record<string, unknown> = {},
) => asOther(t).query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, args);

const byAggregate = <T extends { aggregateId?: string }>(rows: T[]) =>
  new Map(rows.map((row) => [row.aggregateId, row]));

describe("copies of non-approved definitions show only snapshot facts (SEC-34)", () => {
  test("Browse shows another member only the snapshot of a non-approved definition", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const rows = byAggregate((await browse(t)).ownedPuzzles);
    for (const status of HIDDEN) {
      expectSnapshotOnly(rows.get(`copy-${status}`)?.puzzle ?? null, status);
    }
    expectFullFacts(rows.get("copy-approved")?.puzzle ?? null, "approved");
  });

  test("Browse filters only match facts the card shows", async () => {
    const t = convexTest(schema, modules);
    const { category } = await seed(t);
    const found = async (args: Record<string, unknown>) =>
      [...byAggregate((await browse(t, args)).ownedPuzzles).keys()].sort();

    // A word only in the hidden description, or only in the hidden tags, finds the approved copy.
    expect(await found({ searchTerm: "secretword" })).toEqual([
      "copy-approved",
    ]);
    expect(await found({ searchTerm: "hiddentag" })).toEqual(["copy-approved"]);
    // Hidden difficulty and category do not match either.
    expect(await found({ difficulty: "hard" })).toEqual(["copy-approved"]);
    expect(await found({ category })).toEqual(["copy-approved"]);
    // The snapshot title and brand the card shows still match.
    expect(await found({ searchTerm: "snapshot title pending" })).toEqual([
      "copy-pending",
    ]);
    expect(await found({ searchTerm: "ravensburger" })).toEqual([
      "copy-approved",
      "copy-disabled",
      "copy-pending",
      "copy-rejected",
    ]);
    // Piece-count filters use the piece count the card shows (the snapshot's, for hidden ones).
    expect(await found({ maxPieceCount: 600 })).toEqual([
      "copy-disabled",
      "copy-pending",
      "copy-rejected",
    ]);
  });

  test("profile listings show the snapshot only, identically for the owner and other members", async () => {
    const t = convexTest(schema, modules);
    const { submitter } = await seed(t);
    const list = (caller: ReturnType<typeof asOther>) =>
      caller.query(api.social.listProfileCopies.listProfileCopies, {
        memberId: submitter,
        paginationOpts: { numItems: 20, cursor: null },
      });

    const asOtherRows = byAggregate((await list(asOther(t))).page);
    for (const status of HIDDEN) {
      expectSnapshotOnly(
        asOtherRows.get(`copy-${status}`)?.puzzle ?? null,
        status,
      );
    }
    expectFullFacts(
      asOtherRows.get("copy-approved")?.puzzle ?? null,
      "approved",
    );

    // The profile is the visitor-facing projection: the owner sees the same payload.
    expect((await list(asSubmitter(t))).page).toEqual(
      (await list(asOther(t))).page,
    );
  });

  test("the copy page omits hidden difficulty and tags for other members only", async () => {
    const t = convexTest(schema, modules);
    const { copies } = await seed(t);
    const view = (
      caller: ReturnType<typeof asOther>,
      copyId: Id<"ownedPuzzles">,
    ) =>
      caller.query(api.library.getCopyInstanceView.getCopyInstanceView, {
        copyId,
      });

    for (const status of HIDDEN) {
      const seen = await view(asOther(t), copies[status]);
      expect(seen?.snapshot).toMatchObject({
        title: `Snapshot title ${status}`,
        tags: [],
      });
      expect(seen?.snapshot.difficulty).toBeUndefined();

      const own = await view(asSubmitter(t), copies[status]);
      expect(own?.snapshot).toMatchObject({
        difficulty: "hard",
        tags: [`hiddentag-${status}`],
      });
    }
    const approved = await view(asOther(t), copies.approved);
    expect(approved?.snapshot).toMatchObject({
      difficulty: "hard",
      tags: ["hiddentag-approved"],
    });
  });

  test("the owner's own library keeps the full catalogue facts", async () => {
    const t = convexTest(schema, modules);
    const { submitter } = await seed(t);

    const own = byAggregate(
      await asSubmitter(t).query(
        api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
        { ownerId: submitter, includeUnavailable: true },
      ),
    );
    for (const status of [...HIDDEN, "approved"] as const) {
      expectFullFacts(own.get(`copy-${status}`)?.puzzle ?? null, status);
    }

    // Another member reading the same library gets the snapshot only.
    const seen = byAggregate(
      await asOther(t).query(
        api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
        { ownerId: submitter },
      ),
    );
    for (const status of HIDDEN) {
      expectSnapshotOnly(seen.get(`copy-${status}`)?.puzzle ?? null, status);
    }
  });

  test("a legacy copy without a snapshot falls back to the row's title, brand and pieces only", async () => {
    const t = convexTest(schema, modules);
    const { copies } = await seed(t);
    await t.run((ctx) => ctx.db.patch(copies.pending, { snapshot: undefined }));

    const rows = byAggregate((await browse(t)).ownedPuzzles);
    const puzzle = rows.get("copy-pending")?.puzzle ?? null;
    expect(puzzle).toMatchObject({
      title: "Row title pending",
      brand: "Ravensburger",
      pieceCount: 1000,
    });
    expect(puzzle?.description).toBeUndefined();
    expect(puzzle?.tags).toBeUndefined();
  });
});
