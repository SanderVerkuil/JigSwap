import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Bulk household permission: Ann and Bob share a household, Cat is in none. Ann owns three copies
// (absent = manage, explicit view, explicit manage); Bob and Cat own one each.

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

interface World {
  annDefault: Id<"ownedPuzzles">;
  annView: Id<"ownedPuzzles">;
  annManage: Id<"ownedPuzzles">;
  bobCopy: Id<"ownedPuzzles">;
  catCopy: Id<"ownedPuzzles">;
  bob: Id<"users">;
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
    const cat = await mkUser("clerk_cat", "Cat");
    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Shared Shelf",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ann,
      createdAt: now,
      updatedAt: now,
    });
    let order = 0;
    const mkCopy = (
      aggregateId: string,
      ownerId: Id<"users">,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        snapshot: { title: "Shared Shelf", pieceCount: 1000 },
        createdAt: now + order++,
        updatedAt: now,
        ...extra,
      });
    return {
      bob,
      annDefault: await mkCopy("ann-default", ann),
      annView: await mkCopy("ann-view", ann, { householdPermission: "view" }),
      annManage: await mkCopy("ann-manage", ann, {
        householdPermission: "manage",
      }),
      bobCopy: await mkCopy("bob-copy", bob),
      catCopy: await mkCopy("cat-copy", cat),
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

const rows = (t: T, ids: Id<"ownedPuzzles">[]) =>
  t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));

const setMany =
  api.library.setCopiesHouseholdPermission.setCopiesHouseholdPermission;

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("setCopiesHouseholdPermission", () => {
  test("rejects an unauthenticated caller", async () => {
    await expect(
      t.mutation(setMany, { copyIds: [w.annDefault], permission: "view" }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  test("rejects a caller who is not in a household", async () => {
    await expectConvexCode(
      as(t, "cat").mutation(setMany, {
        copyIds: [w.catCopy],
        permission: "view",
      }),
      "NotInHousehold",
    );
    const [cat] = await rows(t, [w.catCopy]);
    expect(cat?.householdPermission).toBeUndefined();
  });

  test("a copy the caller does not own rejects the whole batch and writes nothing", async () => {
    const before = await rows(t, [w.annDefault, w.annManage, w.bobCopy]);
    await expectConvexCode(
      as(t, "ann").mutation(setMany, {
        copyIds: [w.annDefault, w.bobCopy, w.annManage],
        permission: "view",
      }),
      "NotCopyOwner",
    );
    const after = await rows(t, [w.annDefault, w.annManage, w.bobCopy]);
    expect(after.map((r) => r?.householdPermission)).toEqual(
      before.map((r) => r?.householdPermission),
    );
    expect(after.map((r) => r?.updatedAt)).toEqual(
      before.map((r) => r?.updatedAt),
    );
  });

  test("mixed current values give correct counts and only changed rows are written", async () => {
    const [viewBefore] = await rows(t, [w.annView]);
    const result = await as(t, "ann").mutation(setMany, {
      copyIds: [w.annDefault, w.annView, w.annManage],
      permission: "view",
    });
    expect(result).toEqual({ changed: 2, unchanged: 1 });
    const [d, v, m] = await rows(t, [w.annDefault, w.annView, w.annManage]);
    expect([
      d?.householdPermission,
      v?.householdPermission,
      m?.householdPermission,
    ]).toEqual(["view", "view", "view"]);
    // The copy already at the target is not rewritten.
    expect(v?.updatedAt).toBe(viewBefore?.updatedAt);

    const back = await as(t, "ann").mutation(setMany, {
      copyIds: [w.annDefault, w.annView, w.annManage],
      permission: "manage",
    });
    expect(back).toEqual({ changed: 3, unchanged: 0 });
  });

  test("an idempotent re-run reports nothing changed", async () => {
    const args = {
      copyIds: [w.annDefault, w.annView],
      permission: "view" as const,
    };
    await as(t, "ann").mutation(setMany, args);
    expect(await as(t, "ann").mutation(setMany, args)).toEqual({
      changed: 0,
      unchanged: 2,
    });
  });

  test("an explicit choice is written even when it equals the inherited value", async () => {
    // Pinning "manage" on an inheriting copy protects it from a later change of the default.
    expect(
      await as(t, "ann").mutation(setMany, {
        copyIds: [w.annDefault],
        permission: "manage",
      }),
    ).toEqual({ changed: 1, unchanged: 0 });
    const [d] = await rows(t, [w.annDefault]);
    expect(d?.householdPermission).toBe("manage");
  });

  test("duplicate ids are deduped", async () => {
    expect(
      await as(t, "ann").mutation(setMany, {
        copyIds: [w.annDefault, w.annDefault, w.annView, w.annDefault],
        permission: "view",
      }),
    ).toEqual({ changed: 1, unchanged: 1 });
  });

  test("more distinct copies than the cap are rejected and nothing is written", async () => {
    const many = await t.run(async (ctx) => {
      const template = (await ctx.db.get(w.annDefault))!;
      const { _id, _creationTime, ...fields } = template;
      void _id;
      void _creationTime;
      return Promise.all(
        Array.from({ length: 201 }, (_, i) =>
          ctx.db.insert("ownedPuzzles", {
            ...fields,
            aggregateId: `bulk-${i}`,
          }),
        ),
      );
    });
    await expectConvexCode(
      as(t, "ann").mutation(setMany, { copyIds: many, permission: "view" }),
      "PermissionBatchTooLarge",
    );
    const written = await rows(t, many);
    expect(written.every((r) => r?.householdPermission === undefined)).toBe(
      true,
    );

    // The cap counts distinct copies: 201 copies of one id is a batch of one.
    expect(
      await as(t, "ann").mutation(setMany, {
        copyIds: Array.from({ length: 201 }, () => w.annDefault),
        permission: "view",
      }),
    ).toEqual({ changed: 1, unchanged: 0 });
  });
});

describe("listMyHouseholdCopyPermissions", () => {
  const listMine =
    api.household.listMyHouseholdCopyPermissions.listMyHouseholdCopyPermissions;

  test("lists only the caller's own copies with their effective permission", async () => {
    const mine = await as(t, "ann").query(listMine, {});
    expect(mine.map((c) => [c._id, c.householdPermission])).toEqual([
      [w.annManage, "manage"],
      [w.annView, "view"],
      [w.annDefault, "manage"],
    ]);
    expect(mine[0]?.puzzle?.title).toBe("Shared Shelf");
  });

  test("is empty outside a household and rejects the unauthenticated", async () => {
    expect(await as(t, "cat").query(listMine, {})).toEqual([]);
    await expect(t.query(listMine, {})).rejects.toThrow(/Unauthenticated/);
  });
});
