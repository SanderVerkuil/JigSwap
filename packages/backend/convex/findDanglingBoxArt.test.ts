import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-01 forensics: a read-only, paged check that tells whether the box-art takeover already
// happened. It reports definitions whose image blob is gone (destroyed through a member's photo
// row before the claim rule existed) and box art that a member's photo row still holds (attached
// but not yet destroyed). The admin list marks the first kind "Missing cover".

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const blob = (label: string) =>
      ctx.storage.store(new Blob([label], { type: "image/jpeg" }));
    let n = 0;
    const definition = (title: string, image?: Id<"_storage">) =>
      ctx.db.insert("puzzles", {
        aggregateId: `agg-${title}`,
        title,
        pieceCount: 1000,
        ...(image && { image }),
        status: "approved",
        submittedBy: alice,
        createdAt: now + n++,
        updatedAt: now,
      });

    // Healthy: listed box art, also named by an approved proposal. Not reported.
    const healthyArt = await blob("healthy");
    await ctx.db.insert("boxArtUploads", {
      storageId: healthyArt,
      uploaderId: alice,
      createdAt: now,
    });
    const healthy = await definition("Healthy", healthyArt);
    await ctx.db.insert("puzzleChangeProposals", {
      aggregateId: "proposal-1",
      puzzleDefinitionId: "agg-Healthy",
      proposedBy: alice,
      changes: { image: healthyArt },
      baseline: {},
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });

    // No box art at all. Not reported.
    await definition("Bare");

    // Destroyed: the image blob is gone.
    const goneArt = await blob("gone");
    const gone = await definition("Gone", goneArt);
    await ctx.storage.delete(goneArt);

    // Taken over: a copy photo and a completion photo row hold the box art.
    const takenArt = await blob("taken");
    const taken = await definition("Taken", takenArt);
    const copyId = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-1",
      puzzleDefinitionId: "agg-Taken",
      puzzleId: taken,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      snapshot: { title: "Taken", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: alice,
      fileId: takenArt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("completionImages", {
      completionId: "completion-1",
      uploaderId: alice,
      fileId: takenArt,
      createdAt: now,
      updatedAt: now,
    });

    return { healthy, gone, goneArt, taken, takenArt };
  });

const check = (t: T, numItems: number, cursor: string | null) =>
  t.query(internal.catalog.findDanglingBoxArt.findDanglingBoxArt, {
    paginationOpts: { numItems, cursor },
  });

describe("catalog/findDanglingBoxArt", () => {
  test("reports a definition whose image no longer resolves, and box art a photo row holds", async () => {
    const t = convexTest(schema, modules);
    const { gone, goneArt, taken, takenArt } = await seed(t);

    const result = await check(t, 100, null);
    expect(result.isDone).toBe(true);
    expect(result.scanned).toBe(4);
    expect(result.missingImage).toEqual([
      {
        puzzleId: gone,
        aggregateId: "agg-Gone",
        title: "Gone",
        status: "approved",
        image: goneArt,
      },
    ]);
    expect(result.heldByMemberRows).toEqual([
      {
        puzzleId: taken,
        aggregateId: "agg-Taken",
        title: "Taken",
        status: "approved",
        image: takenArt,
        heldBy: ["copyPhoto", "completionPhoto"],
      },
    ]);
  });

  test("pages through the catalogue with a continue cursor", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const page: Awaited<ReturnType<typeof check>> = await check(t, 1, cursor);
      pages++;
      seen.push(
        ...page.missingImage.map((row) => row.title),
        ...page.heldByMemberRows.map((row) => row.title),
      );
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(seen.sort()).toEqual(["Gone", "Taken"]);
  });
});
