import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// library.updateCopyDetails records when and how a copy was acquired (UX-97: the copy page's
// "Acquired" and "Source" could never be filled in). Whoever may manage the copy may set it: the
// owner, or a household member the owner left at "manage". Ann and Bob share a household; Cat is
// an outsider.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  if (typeof data !== "string") return data as { code?: string };
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

const MARCH_2025 = Date.UTC(2025, 2, 1, 12);

interface World {
  bob: Id<"users">;
  // Ann's copies: one Bob may manage (the household default), one he may only view.
  manageCopy: Id<"ownedPuzzles">;
  viewCopy: Id<"ownedPuzzles">;
}

const seed = async (t: T): Promise<World> => {
  const world = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ann = await mkUser("clerk_ann", "Ann");
    const bob = await mkUser("clerk_bob", "Bob");
    await mkUser("clerk_cat", "Cat");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Shared Shelf",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    const mkCopy = (aggregateId: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId: ann,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        snapshot: { title: "Shared Shelf", pieceCount: 1000 },
        notes: "corner bent",
        acquisitionPrice: { amount: 1500, currency: "EUR" },
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    return {
      bob,
      manageCopy: await mkCopy("copy-manage"),
      viewCopy: await mkCopy("copy-view", { householdPermission: "view" }),
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
  return world;
};

const acquisitionOf = (t: T, id: Id<"ownedPuzzles">) =>
  t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    return {
      date: row?.acquisitionDate,
      source: row?.acquisitionSource,
      price: row?.acquisitionPrice,
      notes: row?.notes,
    };
  });

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("library.updateCopyDetails acquisition", () => {
  test("the owner records when and how the copy was acquired; the price and notes stay", async () => {
    await as(t, "ann").mutation(
      api.library.updateCopyDetails.updateCopyDetails,
      {
        copyId: "copy-manage",
        acquisition: { date: MARCH_2025, source: "bought_used" },
      },
    );
    expect(await acquisitionOf(t, w.manageCopy)).toEqual({
      date: MARCH_2025,
      source: "bought_used",
      price: { amount: 1500, currency: "EUR" },
      notes: "corner bent",
    });

    // The owner's copy page shows it back.
    const view = await as(t, "ann").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.manageCopy },
    );
    expect(view?.snapshot.acquisitionDate).toBe(MARCH_2025);
    expect(view?.snapshot.acquisitionSource).toBe("bought_used");
  });

  test("a supplied acquisition replaces both fields, so the owner can clear one", async () => {
    const ann = as(t, "ann");
    await ann.mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: "copy-manage",
      acquisition: { date: MARCH_2025, source: "gift" },
    });
    await ann.mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: "copy-manage",
      acquisition: { source: "gift" },
    });
    expect((await acquisitionOf(t, w.manageCopy)).date).toBeUndefined();
    expect((await acquisitionOf(t, w.manageCopy)).source).toBe("gift");

    // A notes-only update leaves the acquisition alone.
    await ann.mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: "copy-manage",
      notes: "all pieces present",
    });
    expect((await acquisitionOf(t, w.manageCopy)).source).toBe("gift");
  });

  test("a household member at manage may record it", async () => {
    await as(t, "bob").mutation(
      api.library.updateCopyDetails.updateCopyDetails,
      {
        copyId: "copy-manage",
        acquisition: { date: MARCH_2025, source: "trade" },
      },
    );
    const stored = await acquisitionOf(t, w.manageCopy);
    expect(stored.date).toBe(MARCH_2025);
    expect(stored.source).toBe("trade");
  });

  test("a view-only household member and an outsider are refused and nothing changes", async () => {
    await expectConvexCode(
      as(t, "bob").mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-view",
        acquisition: { date: MARCH_2025, source: "gift" },
      }),
      "NotOwner",
    );
    await expectConvexCode(
      as(t, "cat").mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        acquisition: { date: MARCH_2025, source: "gift" },
      }),
      "NotOwner",
    );
    for (const id of [w.viewCopy, w.manageCopy]) {
      const stored = await acquisitionOf(t, id);
      expect(stored.date).toBeUndefined();
      expect(stored.source).toBeUndefined();
    }
  });

  test("an anonymous caller is refused", async () => {
    await expect(
      t.mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        acquisition: { source: "gift" },
      }),
    ).rejects.toThrow();
    expect((await acquisitionOf(t, w.manageCopy)).source).toBeUndefined();
  });
});
