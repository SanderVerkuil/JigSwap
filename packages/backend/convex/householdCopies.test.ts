import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { beforeEach, describe, expect, test } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Household copies: Ann and Bob share a household, Cat is an outsider. Ann's copies are household
// copies for Bob — "manage" (the default, absent field) lets him act as co-owner, "view" only lets
// him see it. Completions stay personal.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const flush = async (t: T) => {
  for (let i = 0; i < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

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
  ann: Id<"users">;
  bob: Id<"users">;
  cat: Id<"users">;
  puzzleId: Id<"puzzles">;
  // Ann's household-only copies (closed + not shared anywhere).
  manageCopy: Id<"ownedPuzzles">;
  viewCopy: Id<"ownedPuzzles">;
  // Bob's own household-only copy.
  bobCopy: Id<"ownedPuzzles">;
  // Cat's tradeable copy.
  catCopy: Id<"ownedPuzzles">;
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
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    return {
      ann,
      bob,
      cat,
      puzzleId,
      manageCopy: await mkCopy("copy-manage", ann),
      viewCopy: await mkCopy("copy-view", ann, { householdPermission: "view" }),
      bobCopy: await mkCopy("copy-bob", bob),
      catCopy: await mkCopy("copy-cat", cat, {
        availability: { forTrade: true, forSale: false, forLend: false },
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
  return world;
};

const copyRow = (t: T, id: Id<"ownedPuzzles">) =>
  t.run((ctx) => ctx.db.get(id));

const storeImage = (t: T, copyId: Id<"ownedPuzzles">, uploader: Id<"users">) =>
  t.run(async (ctx) => {
    const fileId = await ctx.storage.store(
      new Blob(["img"], { type: "image/png" }),
    );
    const now = Date.now();
    return ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copyId,
      uploaderId: uploader,
      fileId,
      moderationStatus: "approved",
      createdAt: now,
      updatedAt: now,
    });
  });

let t: T;
let w: World;

beforeEach(async () => {
  t = withModerationPool(convexTest(schema, modules));
  w = await seed(t);
});

describe("visibility", () => {
  test("a non-member cannot see household-only copies; a member can", async () => {
    expect(
      await as(t, "cat").query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: w.manageCopy },
      ),
    ).toBeNull();
    const asBob = await as(t, "bob").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.viewCopy },
    );
    expect(asBob?.copyId).toBe(w.viewCopy);

    // Ann's profile listing for an outsider omits her household-only copies.
    const catSees = await as(t, "cat").query(
      api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
      { ownerId: w.ann },
    );
    expect(catSees).toEqual([]);
  });

  test("household copies appear in the member's library with owner and access", async () => {
    const bobs = await as(t, "bob").query(
      api.household.listHouseholdCopies.listHouseholdCopies,
      {},
    );
    expect(
      bobs
        .map((c) => [c._id, c.household.owner.name, c.household.viewerAccess])
        .sort(),
    ).toEqual(
      [
        [w.manageCopy, "Ann", "manage"],
        [w.viewCopy, "Ann", "view"],
      ].sort(),
    );
    expect(
      await as(t, "cat").query(
        api.household.listHouseholdCopies.listHouseholdCopies,
        {},
      ),
    ).toEqual([]);
  });

  test("the copy view reports management rights per permission", async () => {
    const manage = await as(t, "bob").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.manageCopy },
    );
    expect(manage?.viewerIsOwner).toBe(false);
    expect(manage?.viewerCanManage).toBe(true);
    expect(manage?.household).toEqual({
      permission: "manage",
      viewerAccess: "manage",
      owner: { memberId: w.ann, name: "Ann" },
      inheritsDefault: true,
      householdDefault: "manage",
    });
    const view = await as(t, "bob").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.viewCopy },
    );
    expect(view?.viewerCanManage).toBe(false);
    expect(view?.household?.viewerAccess).toBe("view");
    const owner = await as(t, "ann").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.viewCopy },
    );
    expect(owner?.viewerCanManage).toBe(true);
    expect(owner?.household).toEqual({
      permission: "view",
      viewerAccess: "owner",
      owner: { memberId: w.ann, name: "Ann" },
      inheritsDefault: false,
      householdDefault: "manage",
    });
  });
});

describe("view-only member cannot mutate; manage member can", () => {
  test("domain copy mutations", async () => {
    const bob = as(t, "bob");
    await expectConvexCode(
      bob.mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-view",
        notes: "nope",
      }),
      "NotOwner",
    );
    await expectConvexCode(
      bob.mutation(api.library.changeCopyCondition.changeCopyCondition, {
        copyId: "copy-view",
        condition: "fair",
      }),
      "NotOwner",
    );
    await expectConvexCode(
      bob.mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId: "copy-view",
        visibility: "visible",
        forLend: true,
      }),
      "NotOwner",
    );

    await bob.mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: "copy-manage",
      notes: "shared",
    });
    await bob.mutation(api.library.changeCopyCondition.changeCopyCondition, {
      copyId: "copy-manage",
      condition: "fair",
    });
    await bob.mutation(api.library.updateCopySharing.updateCopySharing, {
      copyId: "copy-manage",
      visibility: "visible",
      forLend: true,
    });
    const row = await copyRow(t, w.manageCopy);
    expect(row?.notes).toBe("shared");
    expect(row?.condition).toBe("fair");
    expect(row?.availability.forLend).toBe(true);
    expect(row?.ownerId).toBe(w.ann);
  });

  test("an outsider cannot mutate a manage copy", async () => {
    await expectConvexCode(
      as(t, "cat").mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        notes: "nope",
      }),
      "NotOwner",
    );
  });

  test("photos and cover", async () => {
    const bob = as(t, "bob");
    const fileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["img"], { type: "image/png" })),
    );
    await expect(
      bob.mutation(api.library.addCopyPhoto.addCopyPhoto, {
        copyId: w.viewCopy,
        fileId,
      }),
    ).rejects.toThrow(/owner/i);
    await bob.mutation(api.library.addCopyPhoto.addCopyPhoto, {
      copyId: w.manageCopy,
      fileId,
    });

    const viewImage = await storeImage(t, w.viewCopy, w.ann);
    const manageImage = await storeImage(t, w.manageCopy, w.ann);
    await expect(
      bob.mutation(api.library.setCopyCover.setCopyCover, {
        copyId: w.viewCopy,
        coverImageId: viewImage,
      }),
    ).rejects.toThrow();
    await bob.mutation(api.library.setCopyCover.setCopyCover, {
      copyId: w.manageCopy,
      coverImageId: manageImage,
    });
    expect((await copyRow(t, w.manageCopy))?.coverImageId).toBe(manageImage);

    await expect(
      bob.mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
        imageId: viewImage,
      }),
    ).rejects.toThrow(/owner/i);
    await bob.mutation(api.library.removeCopyPhoto.removeCopyPhoto, {
      imageId: manageImage,
    });
    expect(await t.run((ctx) => ctx.db.get(manageImage))).toBeNull();
  });

  test("only the owner deletes or changes the household permission", async () => {
    await expectConvexCode(
      as(t, "bob").mutation(api.library.deleteCopy.deleteCopy, {
        copyId: "copy-manage",
      }),
      "NotOwner",
    );
    await expectConvexCode(
      as(t, "bob").mutation(
        api.library.setCopyHouseholdPermission.setCopyHouseholdPermission,
        { copyId: w.manageCopy, permission: "view" },
      ),
      "NotCopyOwner",
    );

    await as(t, "ann").mutation(
      api.library.setCopyHouseholdPermission.setCopyHouseholdPermission,
      { copyId: w.manageCopy, permission: "view" },
    );
    expect((await copyRow(t, w.manageCopy))?.householdPermission).toBe("view");
    await expectConvexCode(
      as(t, "bob").mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        notes: "now view-only",
      }),
      "NotOwner",
    );
  });
});

describe("lending", () => {
  const lendToCat = (copyId: Id<"ownedPuzzles">, aggregateId: string) =>
    t.run(async (ctx) => {
      await ctx.db.patch(copyId, { heldBy: w.cat });
      return ctx.db.insert("loans", {
        aggregateId: `loan-${aggregateId}`,
        copyId: aggregateId,
        lenderId: w.ann,
        borrowerId: w.cat,
        status: "open",
        openedAt: Date.now(),
      });
    });

  test("a manage member sees and recalls the owner's loan; a view member cannot", async () => {
    await lendToCat(w.manageCopy, "copy-manage");
    await lendToCat(w.viewCopy, "copy-view");

    const lentOut = await as(t, "bob").query(
      api.library.getLentOutLoans.getLentOutLoans,
      {},
    );
    expect(lentOut.map((l) => l.loanId)).toEqual(["loan-copy-manage"]);

    await expectConvexCode(
      as(t, "bob").mutation(api.library.recallLoan.recallLoan, {
        loanId: "loan-copy-view",
      }),
      "NotLender",
    );
    await as(t, "bob").mutation(api.library.recallLoan.recallLoan, {
      loanId: "loan-copy-manage",
    });
    const loan = await t.run((ctx) =>
      ctx.db
        .query("loans")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", "loan-copy-manage"),
        )
        .unique(),
    );
    expect(loan?.status).toBe("recalled");
    expect(loan?.lenderId).toBe(w.ann);
    expect((await copyRow(t, w.manageCopy))?.heldBy).toBe(w.ann);
  });
});

describe("swapping", () => {
  test("a manage member may offer a household copy; a view member may not", async () => {
    await expectConvexCode(
      as(t, "bob").mutation(api.exchange.propose.propose, {
        recipientId: w.cat,
        type: "trade",
        requestedPuzzleId: w.catCopy,
        offeredPuzzleId: w.viewCopy,
      }),
      "OfferedCopyNotOwned",
    );
    const exchangeId = await as(t, "bob").mutation(
      api.exchange.propose.propose,
      {
        recipientId: w.cat,
        type: "trade",
        requestedPuzzleId: w.catCopy,
        offeredPuzzleId: w.manageCopy,
      },
    );
    expect(typeof exchangeId).toBe("string");
  });

  test("ownership moving away clears the copy's household permission", async () => {
    await t.run((ctx) =>
      ctx.db.patch(w.viewCopy, {
        availability: { forTrade: true, forSale: false, forLend: false },
      }),
    );
    const exchangeId = await as(t, "cat").mutation(
      api.exchange.propose.propose,
      {
        recipientId: w.ann,
        type: "trade",
        requestedPuzzleId: w.viewCopy,
        offeredPuzzleId: w.catCopy,
      },
    );
    await as(t, "ann").mutation(api.exchange.accept.accept, { exchangeId });
    await as(t, "cat").mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await as(t, "ann").mutation(
      api.exchange.confirmCompletion.confirmCompletion,
      { exchangeId },
    );
    await flush(t);

    const moved = await copyRow(t, w.viewCopy);
    expect(moved?.ownerId).toBe(w.cat);
    expect(moved?.householdPermission).toBeUndefined();
  });
});

describe("leaving", () => {
  test("leaving removes the leaver's copies from the others' library and access", async () => {
    const annBefore = await as(t, "ann").query(
      api.household.listHouseholdCopies.listHouseholdCopies,
      {},
    );
    expect(annBefore.map((c) => c._id)).toEqual([w.bobCopy]);

    await as(t, "bob").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );

    expect(
      await as(t, "ann").query(
        api.household.listHouseholdCopies.listHouseholdCopies,
        {},
      ),
    ).toEqual([]);
    expect(
      await as(t, "ann").query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: w.bobCopy },
      ),
    ).toBeNull();
    expect(
      await as(t, "bob").query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId: w.manageCopy },
      ),
    ).toBeNull();
    await expectConvexCode(
      as(t, "bob").mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        notes: "gone",
      }),
      "NotOwner",
    );
    // Copies stay with their owners.
    expect((await copyRow(t, w.bobCopy))?.ownerId).toBe(w.bob);
  });
});

describe("completions stay personal", () => {
  const logSolve = (who: Who, copyId: string) =>
    as(t, who).mutation(api.solving.recordCompletion.recordCompletion, {
      copyId,
      startDate: Date.now() - 2 * 86_400_000,
      endDate: Date.now() - 86_400_000,
    });

  test("each member logs their own solve on a household copy; nothing is shared", async () => {
    await logSolve("bob", "copy-manage");
    await logSolve("bob", "copy-view");
    await logSolve("ann", "copy-manage");

    const bobs = await as(t, "bob").query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    const anns = await as(t, "ann").query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(bobs).toHaveLength(2);
    expect(anns).toHaveLength(1);
  });

  test("an outsider cannot log a solve on a household copy", async () => {
    await expect(logSolve("cat", "copy-manage")).rejects.toThrow(
      /owner|holder|household/i,
    );
  });

  test("a member can start a solve on a household copy", async () => {
    await as(t, "bob").mutation(api.solving.startCompletion.startCompletion, {
      copyId: "copy-view",
      startDate: Date.now(),
    });
    const anns = await as(t, "ann").query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(anns).toEqual([]);
  });
});

describe("household default copy permission", () => {
  const setDefault =
    api.household.setDefaultCopyPermission.setDefaultCopyPermission;
  const setOne =
    api.library.setCopyHouseholdPermission.setCopyHouseholdPermission;
  const bobAccessTo = async (copyId: Id<"ownedPuzzles">) =>
    (
      await as(t, "bob").query(
        api.library.getCopyInstanceView.getCopyInstanceView,
        { copyId },
      )
    )?.household?.viewerAccess;

  test("a 'view' default governs copies without an explicit value; an explicit 'manage' overrides it", async () => {
    expect(
      await as(t, "ann").mutation(setDefault, { permission: "view" }),
    ).toEqual({ changed: true });

    expect(await bobAccessTo(w.manageCopy)).toBe("view");
    const listed = await as(t, "bob").query(
      api.household.listHouseholdCopies.listHouseholdCopies,
      {},
    );
    expect(
      listed.find((c) => c._id === w.manageCopy)?.household.viewerAccess,
    ).toBe("view");
    const bob = as(t, "bob");
    await expectConvexCode(
      bob.mutation(api.library.updateCopyDetails.updateCopyDetails, {
        copyId: "copy-manage",
        notes: "edit",
      }),
      "NotOwner",
    );
    await expectConvexCode(
      bob.mutation(api.library.updateCopySharing.updateCopySharing, {
        copyId: "copy-manage",
        visibility: "visible",
        forLend: true,
      }),
      "NotOwner",
    );
    await expectConvexCode(
      bob.mutation(api.exchange.propose.propose, {
        recipientId: w.cat,
        type: "trade",
        requestedPuzzleId: w.catCopy,
        offeredPuzzleId: w.manageCopy,
      }),
      "OfferedCopyNotOwned",
    );

    await as(t, "ann").mutation(setOne, {
      copyId: w.manageCopy,
      permission: "manage",
    });
    expect(await bobAccessTo(w.manageCopy)).toBe("manage");
    await bob.mutation(api.library.updateCopyDetails.updateCopyDetails, {
      copyId: "copy-manage",
      notes: "edit",
    });
    expect((await copyRow(t, w.manageCopy))?.notes).toBe("edit");
    expect(
      typeof (await bob.mutation(api.exchange.propose.propose, {
        recipientId: w.cat,
        type: "trade",
        requestedPuzzleId: w.catCopy,
        offeredPuzzleId: w.manageCopy,
      })),
    ).toBe("string");
  });

  test("only the household admin may change the default", async () => {
    await expectConvexCode(
      as(t, "bob").mutation(setDefault, { permission: "view" }),
      "NotHouseholdAdmin",
    );
    await expectConvexCode(
      as(t, "cat").mutation(setDefault, { permission: "view" }),
      "NotInHousehold",
    );
    await expect(
      t.mutation(setDefault, { permission: "view" }),
    ).rejects.toThrow(/Unauthenticated/);
    const mine = await as(t, "bob").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(mine?.defaultCopyPermission).toBe("manage");
  });

  test("the household reports its default and how many copies follow it", async () => {
    // Ann's manageCopy and Bob's bobCopy have no explicit value; Ann's viewCopy does; Cat is out.
    const before = await as(t, "bob").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(before?.defaultCopyPermission).toBe("manage");
    expect(before?.copiesUsingDefault).toBe(2);
    await as(t, "ann").mutation(setDefault, { permission: "view" });
    const after = await as(t, "ann").query(
      api.household.getMyHousehold.getMyHousehold,
      {},
    );
    expect(after?.defaultCopyPermission).toBe("view");
    expect(after?.copiesUsingDefault).toBe(2);
    expect(
      await as(t, "ann").mutation(setDefault, { permission: "view" }),
    ).toEqual({ changed: false });
  });

  test("clearing an explicit value falls back to the household default", async () => {
    await as(t, "ann").mutation(setDefault, { permission: "view" });
    await as(t, "ann").mutation(setOne, {
      copyId: w.manageCopy,
      permission: "manage",
    });
    expect(await bobAccessTo(w.manageCopy)).toBe("manage");

    await as(t, "ann").mutation(setOne, {
      copyId: w.manageCopy,
      permission: "default",
    });
    expect(
      (await copyRow(t, w.manageCopy))?.householdPermission,
    ).toBeUndefined();
    expect(await bobAccessTo(w.manageCopy)).toBe("view");
    const ownerView = await as(t, "ann").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.manageCopy },
    );
    expect(ownerView?.household).toEqual({
      permission: "view",
      viewerAccess: "owner",
      inheritsDefault: true,
      householdDefault: "view",
      owner: { memberId: w.ann, name: "Ann" },
    });
  });

  test("the bulk 'default' choice clears explicit values", async () => {
    await as(t, "ann").mutation(setDefault, { permission: "view" });
    expect(
      await as(t, "ann").mutation(
        api.library.setCopiesHouseholdPermission.setCopiesHouseholdPermission,
        { copyIds: [w.manageCopy, w.viewCopy], permission: "default" },
      ),
    ).toEqual({ changed: 1, unchanged: 1 });
    expect((await copyRow(t, w.viewCopy))?.householdPermission).toBeUndefined();

    const mine = await as(t, "ann").query(
      api.household.listMyHouseholdCopyPermissions
        .listMyHouseholdCopyPermissions,
      {},
    );
    expect(
      mine
        .map((c) => [c._id, c.householdPermission, c.permissionSource])
        .sort(),
    ).toEqual(
      [
        [w.manageCopy, "view", "default"],
        [w.viewCopy, "view", "default"],
      ].sort(),
    );
  });

  test("a leaving owner's copies are no longer governed by the old household default", async () => {
    await as(t, "ann").mutation(setDefault, { permission: "view" });
    await as(t, "ann").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    // Ann left; Bob (promoted admin) keeps the household and its "view" default.
    expect(
      (
        await as(t, "bob").query(
          api.household.getMyHousehold.getMyHousehold,
          {},
        )
      )?.defaultCopyPermission,
    ).toBe("view");

    // Ann starts a new household and invites Cat: Ann's inheriting copy now follows the NEW
    // household (manage), not the one she left.
    await as(t, "ann").mutation(
      api.household.createHousehold.createHousehold,
      {},
    );
    const inviteId = await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: w.cat },
    );
    await as(t, "cat").mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
    const catSees = await as(t, "cat").query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: w.manageCopy },
    );
    expect(catSees?.household?.viewerAccess).toBe("manage");
    const annMine = await as(t, "ann").query(
      api.household.listMyHouseholdCopyPermissions
        .listMyHouseholdCopyPermissions,
      {},
    );
    expect(
      annMine.find((c) => c._id === w.manageCopy)?.householdPermission,
    ).toBe("manage");
    // Bob no longer reaches Ann's copies at all.
    expect(await bobAccessTo(w.manageCopy)).toBeUndefined();
  });
});
