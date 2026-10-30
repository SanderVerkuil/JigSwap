import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// library.getCopyDocId resolves a copy's domain id (aggregateId, what acquireCopy returns) to the
// ownedPuzzles _id the copy page is keyed on — but only for a member who may manage the copy.
// Ann and Bob share a household (Bob manages Ann's copies by default); Cat is an outsider.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

interface World {
  annCopy: Id<"ownedPuzzles">;
  annViewOnlyCopy: Id<"ownedPuzzles">;
}

const seed = async (t: T): Promise<World> => {
  const world = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (who: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await mkUser("ann");
    const bob = await mkUser("bob");
    await mkUser("cat");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (
      aggregateId: string,
      extra: { householdPermission?: "view" | "manage" } = {},
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId: ann,
        condition: "good",
        // Offered, so an outsider may VIEW the copy; managing it is still refused.
        availability: { forTrade: true, forSale: false, forLend: false },
        snapshot: { title: "Harbour Lights", pieceCount: 1000 },
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    return {
      bob,
      annCopy: await mkCopy("copy-ann"),
      annViewOnlyCopy: await mkCopy("copy-ann-view", {
        householdPermission: "view",
      }),
    };
  });

  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "ann").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: world.bob },
  );
  await as(t, "bob").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
  return { annCopy: world.annCopy, annViewOnlyCopy: world.annViewOnlyCopy };
};

const docIdOf = (t: T, who: Who, copyId: string) =>
  as(t, who).query(api.library.getCopyDocId.getCopyDocId, { copyId });

let t: T;
let w: World;

beforeEach(async () => {
  t = withModerationPool(convexTest(schema, modules));
  w = await seed(t);
});

describe("library.getCopyDocId", () => {
  test("requires authentication", async () => {
    await expect(
      t.query(api.library.getCopyDocId.getCopyDocId, { copyId: "copy-ann" }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("the owner gets the copy's document id", async () => {
    expect(await docIdOf(t, "ann", "copy-ann")).toBe(w.annCopy);
  });

  test("a household member who may manage the copy gets it", async () => {
    expect(await docIdOf(t, "bob", "copy-ann")).toBe(w.annCopy);
  });

  test("a household member with view-only access gets null", async () => {
    expect(await docIdOf(t, "bob", "copy-ann-view")).toBeNull();
    // The owner still resolves it.
    expect(await docIdOf(t, "ann", "copy-ann-view")).toBe(w.annViewOnlyCopy);
  });

  test("a stranger gets null, even for a copy they could view", async () => {
    expect(await docIdOf(t, "cat", "copy-ann")).toBeNull();
  });

  test("an unknown copy id gets null", async () => {
    expect(await docIdOf(t, "ann", "no-such-copy")).toBeNull();
  });

  test("a copy acquired through acquireCopy resolves for its owner", async () => {
    const puzzleAggregateId = "def-harbour";
    await t.run(async (ctx) => {
      const now = Date.now();
      const ann = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_ann"))
        .unique();
      if (!ann) throw new Error("ann missing");
      await ctx.db.insert("puzzles", {
        aggregateId: puzzleAggregateId,
        title: "Harbour Lights II",
        pieceCount: 500,
        status: "approved",
        submittedBy: ann._id,
        createdAt: now,
        updatedAt: now,
      });
    });
    const copyId = (await as(t, "ann").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;

    const docId = await docIdOf(t, "ann", copyId);
    const row = docId ? await t.run((ctx) => ctx.db.get(docId)) : null;
    expect(row?.aggregateId).toBe(copyId);
  });
});
