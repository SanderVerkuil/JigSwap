import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Rule P (canViewCopy) lets the other party of an exchange see a PRIVATE copy. A copy keeps its id
// through every sale, so the rule must be bound to the copy's CURRENT owner: only an exchange
// between the viewer and whoever owns the copy now counts. Earlier links in a resale chain and
// stale proposers to a former owner see nothing once the current owner makes the copy private.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Name = "ann" | "ben" | "cat" | "dan";

const as = (t: T, name: Name) => t.withIdentity({ subject: `clerk_${name}` });

// The transfer runs in a scheduled dispatch; yield then drain until the chain settles.
const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Ann, Ben and Dan have no profile row (public by default); Cat is PRIVATE. Nobody follows anyone,
// shares a circle or a household, so rule P is the only way into a private copy.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: Name) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ids = {
      ann: await mkUser("ann"),
      ben: await mkUser("ben"),
      cat: await mkUser("cat"),
      dan: await mkUser("dan"),
    };
    await ctx.db.insert("profiles", {
      memberId: ids.cat,
      displayName: "Cat",
      visibility: "private",
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ids.ann,
      createdAt: now,
      updatedAt: now,
    });
    return { ids, puzzleAggregateId };
  });

const copyRowOf = (t: T, copyAggregateId: string) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyAggregateId))
      .unique();
    if (!row) throw new Error("seed: copy not found");
    return row;
  });

const setSharing = (
  t: T,
  owner: Name,
  copyAggregateId: string,
  sharing: "private" | "forSale",
) =>
  as(t, owner).mutation(api.library.updateCopySharing.updateCopySharing, {
    copyId: copyAggregateId,
    ...(sharing === "private"
      ? { visibility: "private" as const }
      : { visibility: "visible" as const, forSale: true }),
  });

const proposeSale = (t: T, buyer: Name, copy: Id<"ownedPuzzles">) =>
  as(t, buyer).mutation(api.exchange.propose.propose, {
    type: "sale",
    requestedPuzzleId: copy,
    salePrice: 1000,
  });

// Settle a proposed sale through the real flow: the seller accepts, both confirm, the transfer runs.
const settle = async (t: T, exchangeId: string, buyer: Name, seller: Name) => {
  await as(t, seller).mutation(api.exchange.accept.accept, { exchangeId });
  await as(t, buyer).mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId },
  );
  await as(t, seller).mutation(
    api.exchange.confirmCompletion.confirmCompletion,
    { exchangeId },
  );
  await flushScheduled(t);
};

const viewCopy = (t: T, name: Name, copy: Id<"ownedPuzzles">) =>
  as(t, name).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId: copy,
  });

const exchangeStatus = (t: T, exchangeId: string) =>
  t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("exchanges")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", exchangeId))
          .unique()
      )?.status,
  );

describe("rule P is bound to the copy's current owner", () => {
  test("a resale chain: only the current owner's direct counterparty keeps seeing a private copy", async () => {
    const t = convexTest(schema, modules);
    const { ids, puzzleAggregateId } = await seed(t);

    const copyAggregateId = (await as(t, "ann").mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;
    const copy = (await copyRowOf(t, copyAggregateId))._id;

    // Ann sells the copy to Ben.
    await setSharing(t, "ann", copyAggregateId, "forSale");
    await settle(t, await proposeSale(t, "ben", copy), "ben", "ann");
    expect((await copyRowOf(t, copyAggregateId)).ownerId).toBe(ids.ben);

    // Control: while Ben owns it, Ann is his direct counterparty, so she sees it when he makes it
    // private (rule P as it was meant).
    await setSharing(t, "ben", copyAggregateId, "private");
    expect(await viewCopy(t, "ann", copy)).not.toBeNull();

    // Ben puts it up for sale again; Dan and Cat both ask for it, and Ben sells it to Cat. Dan's
    // request to Ben stays open (nothing resolves it yet).
    await setSharing(t, "ben", copyAggregateId, "forSale");
    const dansRequest = await proposeSale(t, "dan", copy);
    await settle(t, await proposeSale(t, "cat", copy), "cat", "ben");
    expect((await copyRowOf(t, copyAggregateId)).ownerId).toBe(ids.cat);
    expect(await exchangeStatus(t, dansRequest)).toBe("proposed");

    // Visible but not offered, and Cat's profile is private: no rule lets Ann or Dan in.
    expect(await viewCopy(t, "ann", copy)).toBeNull();
    expect(await viewCopy(t, "dan", copy)).toBeNull();

    // Making it private must not open it up to anyone earlier in the chain.
    await setSharing(t, "cat", copyAggregateId, "private");
    // Ann sold it two owners back and never dealt with Cat.
    expect(await viewCopy(t, "ann", copy)).toBeNull();
    // Dan's open request was made to Ben, a former owner, not to Cat.
    expect(await viewCopy(t, "dan", copy)).toBeNull();
    // Ben sold it to Cat: he is the current owner's direct counterparty and keeps its history.
    const bensView = await viewCopy(t, "ben", copy);
    expect(bensView).not.toBeNull();
    expect(bensView?.snapshot.visibility).toBe("private");
    // Cat herself, of course.
    expect(await viewCopy(t, "cat", copy)).not.toBeNull();
  });
});

// A household co-manager may offer the owner's copy in a swap (mayOfferCopy). The swap's recipient
// then sees that copy while it is private, as long as it still belongs to the owner it was offered
// for (the exchange records them as offeredPuzzleOwnerId) and the co-manager may still offer it.
// Bound to the current owner like the rest of rule P: the copy changing hands (even to another
// housemate the co-manager also manages) or the co-manager leaving ends it.
type HouseholdName = "mara" | "hugo" | "ivy" | "rex" | "zoe";

const asMember = (t: T, name: HouseholdName) =>
  t.withIdentity({ subject: `clerk_${name}` });

const seedHousehold = async (t: T) => {
  const { ids, puzzleAggregateId } = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: HouseholdName) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const ids = {
      mara: await mkUser("mara"),
      hugo: await mkUser("hugo"),
      ivy: await mkUser("ivy"),
      rex: await mkUser("rex"),
      zoe: await mkUser("zoe"),
    };
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: ids.mara,
      createdAt: now,
      updatedAt: now,
    });
    return { ids, puzzleAggregateId };
  });
  // Mara, Hugo and Ivy share a household (default permission: manage).
  await asMember(t, "mara").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  for (const mate of ["hugo", "ivy"] as const) {
    const inviteId = await asMember(t, "mara").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: ids[mate] },
    );
    await asMember(t, mate).mutation(
      api.household.acceptHouseholdInvite.acceptHouseholdInvite,
      { inviteId },
    );
  }
  const acquire = async (owner: HouseholdName) => {
    const aggregateId = (await asMember(t, owner).mutation(
      api.library.acquireCopy.acquireCopy,
      { puzzleDefinitionId: puzzleAggregateId, condition: "good" },
    )) as string;
    return { aggregateId, id: (await copyRowOf(t, aggregateId))._id };
  };
  const x = await acquire("mara");
  const r = await acquire("rex");
  await asMember(t, "rex").mutation(
    api.library.updateCopySharing.updateCopySharing,
    { copyId: r.aggregateId, visibility: "visible", forTrade: true },
  );
  // Hugo offers Mara's X for Rex's R; then Mara makes X private.
  const swap = await asMember(t, "hugo").mutation(
    api.exchange.propose.propose,
    {
      type: "trade",
      requestedPuzzleId: r.id,
      offeredPuzzleId: x.id,
    },
  );
  await asMember(t, "mara").mutation(
    api.library.updateCopySharing.updateCopySharing,
    { copyId: x.aggregateId, visibility: "private" },
  );
  return { ids, x, swap };
};

const sees = (t: T, name: HouseholdName, copy: Id<"ownedPuzzles">) =>
  asMember(t, name).query(api.library.getCopyInstanceView.getCopyInstanceView, {
    copyId: copy,
  });
const rexSees = (t: T, copy: Id<"ownedPuzzles">) => sees(t, "rex", copy);

describe("rule P for a copy a household co-manager offered", () => {
  test("the swap's recipient sees the owner's private copy until it has another owner", async () => {
    const t = convexTest(schema, modules);
    const { ids, x, swap } = await seedHousehold(t);
    const view = await rexSees(t, x.id);
    expect(view).not.toBeNull();
    expect(view?.snapshot.visibility).toBe("private");
    // Only the swap's recipient: Zoe, no party to it, sees nothing.
    expect(await sees(t, "zoe", x.id)).toBeNull();

    // X passes to Ivy (as a settled deal would move it). Hugo co-manages Ivy's copies too, but the
    // swap offered Mara's copy: it shows Rex nothing of Ivy's.
    await t.run((ctx) => ctx.db.patch(x.id, { ownerId: ids.ivy }));
    expect(await exchangeStatus(t, swap)).toBe("proposed");
    expect(await rexSees(t, x.id)).toBeNull();
  });

  test("the recipient loses it once they decline the swap", async () => {
    const t = convexTest(schema, modules);
    const { x, swap } = await seedHousehold(t);
    expect(await rexSees(t, x.id)).not.toBeNull();

    await asMember(t, "rex").mutation(api.exchange.decline.decline, {
      exchangeId: swap,
    });
    expect(await rexSees(t, x.id)).toBeNull();
  });

  test("the recipient loses it once the co-manager leaves the household", async () => {
    const t = convexTest(schema, modules);
    const { ids, x, swap } = await seedHousehold(t);
    expect(await rexSees(t, x.id)).not.toBeNull();

    await asMember(t, "mara").mutation(
      api.household.removeHouseholdMember.removeHouseholdMember,
      { memberId: ids.hugo },
    );
    expect(await exchangeStatus(t, swap)).toBe("proposed");
    expect(await rexSees(t, x.id)).toBeNull();
  });
});
