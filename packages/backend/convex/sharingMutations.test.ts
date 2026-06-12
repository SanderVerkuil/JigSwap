import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Seed three members + a catalog puzzle (with aggregateId) the snapshot provider can resolve.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, email: string) =>
      ctx.db.insert("users", {
        clerkId,
        email,
        name: clerkId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("clerk_alice", "alice@example.com");
    const bob = await mkUser("clerk_bob", "bob@example.com");
    const carol = await mkUser("clerk_carol", "carol@example.com");
    const puzzleAggregateId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob, carol, puzzleAggregateId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asCarol = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_carol" });

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<unknown>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectConvexCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(ConvexError);
  await p.catch((e: unknown) => {
    expect(dataOf(e).code).toBe(code);
  });
};

// Alice creates a circle, returning its CircleId (aggregateId).
const createCircleForAlice = async (t: ReturnType<typeof convexTest>) =>
  (await asAlice(t).mutation(api.sharing.createCircle.createCircle, {
    name: "Saturday Puzzlers",
  })) as string;

const circleRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

describe("sharing.createCircle", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.mutation(api.sharing.createCircle.createCircle, { name: "x" }),
    ).rejects.toThrow("Unauthenticated");
  });

  test("seeds the owner as the first Admin member, derived from auth", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const circleId = await createCircleForAlice(t);

    const row = await circleRow(t, circleId);
    expect(row?.ownerId).toBe(alice);
    expect(row?.memberships).toHaveLength(1);
    expect(row?.memberships[0]).toMatchObject({
      memberId: alice,
      permission: "Admin",
    });

    // The member-lookup projection mirrors the embedded membership.
    const links = await t.run(async (ctx) =>
      ctx.db
        .query("circleMembers")
        .withIndex("by_circle", (q) => q.eq("circleAggregateId", circleId))
        .collect(),
    );
    expect(links.map((l) => l.memberId)).toEqual([alice]);
  });

  test("lists the creator's circle in listMyCircles", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);

    const mine = await asAlice(t).query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].aggregateId).toBe(circleId);
    expect(mine[0].isOwnedByViewer).toBe(true);
  });
});

describe("sharing.addMember", () => {
  test("an admin adds a member, projecting the lookup row", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);

    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "Exchange",
    });

    const row = await circleRow(t, circleId);
    expect(row?.memberships).toHaveLength(2);
    expect(row?.memberships.find((m) => m.memberId === bob)?.permission).toBe(
      "Exchange",
    );

    // Bob now sees the circle (member lookup goes through the projection).
    const bobsCircles = await asBob(t).query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(bobsCircles.map((c) => c.aggregateId)).toContain(circleId);
  });

  test("a non-admin cannot add members (NotCircleAdmin)", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "ViewOnly",
    });

    await expectConvexCode(
      asBob(t).mutation(api.sharing.addMember.addMember, {
        circleId,
        memberId: carol,
        permission: "ViewOnly",
      }),
      "NotCircleAdmin",
    );
  });

  test("adding the same member twice fails (AlreadyMember)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    const add = () =>
      asAlice(t).mutation(api.sharing.addMember.addMember, {
        circleId,
        memberId: bob,
        permission: "ViewOnly",
      });
    await add();
    await expectConvexCode(add(), "AlreadyMember");
  });
});

describe("sharing.removeMember / changePermission", () => {
  test("removing the owner is refused (CannotRemoveOwner)", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await expectConvexCode(
      asAlice(t).mutation(api.sharing.removeMember.removeMember, {
        circleId,
        memberId: alice,
      }),
      "CannotRemoveOwner",
    );
  });

  test("an admin removes a member and the lookup row is dropped", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "ViewOnly",
    });

    await asAlice(t).mutation(api.sharing.removeMember.removeMember, {
      circleId,
      memberId: bob,
    });

    const row = await circleRow(t, circleId);
    expect(row?.memberships.some((m) => m.memberId === bob)).toBe(false);
    const bobsCircles = await asBob(t).query(
      api.sharing.listMyCircles.listMyCircles,
      {},
    );
    expect(bobsCircles).toHaveLength(0);
  });

  test("changing to the same permission fails (DuplicatePermission)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "ViewOnly",
    });
    await expectConvexCode(
      asAlice(t).mutation(api.sharing.changePermission.changePermission, {
        circleId,
        memberId: bob,
        permission: "ViewOnly",
      }),
      "DuplicatePermission",
    );
  });
});

describe("sharing.getCircle visibility", () => {
  test("a non-member sees null", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const circleId = await createCircleForAlice(t);
    const seen = await asCarol(t).query(api.sharing.getCircle.getCircle, {
      circleId,
    });
    expect(seen).toBeNull();
  });

  test("a member sees the circle with its resolved members", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "Admin",
    });
    const detail = await asBob(t).query(api.sharing.getCircle.getCircle, {
      circleId,
    });
    expect(detail?.members).toHaveLength(2);
    expect(detail?.members.find((m) => m.isOwner)?.memberId).toBeDefined();
  });
});

// --- Circle-aware visibility (cross-context) ---------------------------------------------------

// Alice acquires a copy and keeps it PRIVATE (no exchange availability).
const acquirePrivateForAlice = async (
  t: ReturnType<typeof convexTest>,
  puzzleAggregateId: string,
) =>
  (await asAlice(t).mutation(api.library.acquireCopy.acquireCopy, {
    puzzleDefinitionId: puzzleAggregateId,
    condition: "good",
  })) as string;

describe("library.browseOwnedPuzzles circle-aware visibility", () => {
  test("a private copy shared into a circle is visible to a fellow member", async () => {
    const t = convexTest(schema, modules);
    const { bob, puzzleAggregateId } = await seed(t);
    const copyId = await acquirePrivateForAlice(t, puzzleAggregateId);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.addMember.addMember, {
      circleId,
      memberId: bob,
      permission: "ViewOnly",
    });
    await asAlice(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId,
    });

    // Bob browses: the private-but-circle-shared copy surfaces for him.
    const view = await asBob(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    );
    expect(view.ownedPuzzles.some((c) => c.aggregateId === copyId)).toBe(true);
  });

  test("a private copy shared into a circle stays hidden from a non-member (public path preserved)", async () => {
    const t = convexTest(schema, modules);
    const { puzzleAggregateId } = await seed(t);
    const copyId = await acquirePrivateForAlice(t, puzzleAggregateId);
    const circleId = await createCircleForAlice(t);
    await asAlice(t).mutation(api.sharing.shareCopyToCircle.shareCopyToCircle, {
      circleId,
      copyId,
    });

    // Carol is in no circle: she sees no circle-shared private copies.
    const view = await asCarol(t).query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    );
    expect(view.ownedPuzzles.some((c) => c.aggregateId === copyId)).toBe(false);
  });
});
