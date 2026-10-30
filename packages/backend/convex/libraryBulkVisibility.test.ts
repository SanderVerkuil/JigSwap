import { convexTest, type TestConvex } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { canViewCopy } from "./library/canViewCopy";
import schema from "./schema";

// Parity of the bulk copy reads with THE per-copy gate (PERF-B5q): a non-owner reading another
// member's library (library.getOwnedPuzzlesByOwner) or a public collection of theirs
// (library.getCollectionById) sees exactly the copies `canViewCopy` lets them see, one by one. The
// world exercises every rule of the gate: public+open, private profile, household mate, mutual
// follower, block, circle share, holder and exchange party on a private copy.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Owner = "olive" | "pia";
type Viewer = "sam" | "hal" | "mia" | "bea" | "cid" | "xan";
type Who = Owner | Viewer;

const OWNERS: readonly Owner[] = ["olive", "pia"];
const VIEWERS: readonly Viewer[] = ["sam", "hal", "mia", "bea", "cid", "xan"];

interface World {
  users: Record<Who, Id<"users">>;
  copies: Record<Owner, Record<string, Id<"ownedPuzzles">>>;
  collections: Record<Owner, Id<"collections">>;
}

const closed = { forTrade: false, forSale: false, forLend: false };
const open = { forTrade: true, forSale: false, forLend: false };

// Olive has a PUBLIC profile, Pia a PRIVATE one. Viewers: Sam a stranger, Hal Olive's household
// mate, Mia a mutual follower of both, Bea blocked by Olive (and mutual with her), Cid in Pia's
// circle where one open copy is shared, Xan holding one of Olive's closed copies and party to an
// accepted exchange over Pia's private copy.
const seed = (t: T): Promise<World> =>
  t.run(async (ctx) => {
    const now = Date.now();
    const user = (name: Who) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const users = {} as Record<Who, Id<"users">>;
    for (const name of [...OWNERS, ...VIEWERS]) users[name] = await user(name);

    await ctx.db.insert("profiles", {
      memberId: users.pia,
      visibility: "private",
      updatedAt: now,
    });
    for (const memberId of [users.olive, users.hal]) {
      await ctx.db.insert("householdMembers", {
        householdId: "hh-olive",
        memberId,
        role: memberId === users.olive ? "admin" : "member",
        joinedAt: now,
      });
    }
    const follow = (followerId: Id<"users">, followeeId: Id<"users">) =>
      ctx.db.insert("follows", {
        aggregateId: crypto.randomUUID(),
        followerId,
        followeeId,
        createdAt: now,
      });
    for (const [a, b] of [
      [users.mia, users.olive],
      [users.mia, users.pia],
      [users.bea, users.olive],
    ] as const) {
      await follow(a, b);
      await follow(b, a);
    }
    await ctx.db.insert("blocks", {
      blockerId: users.olive,
      blockedId: users.bea,
      createdAt: now,
    });

    const puzzleId = await ctx.db.insert("puzzles", {
      title: "Shelf",
      pieceCount: 1000,
      status: "approved",
      submittedBy: users.olive,
      createdAt: now,
      updatedAt: now,
    });
    let tick = 0;
    const copy = (
      ownerId: Id<"users">,
      aggregateId: string,
      extra: Partial<Doc<"ownedPuzzles">> = {},
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId,
        ownerId,
        condition: "good",
        availability: closed,
        createdAt: now + tick++,
        updatedAt: now,
        ...extra,
      });
    const privately = {
      visibility: "private" as const,
      visibilityAuthoritative: true,
    };
    const copies = {
      olive: {
        open: await copy(users.olive, "olive-open", { availability: open }),
        closed: await copy(users.olive, "olive-closed"),
        private: await copy(users.olive, "olive-private", privately),
        heldByXan: await copy(users.olive, "olive-held", { heldBy: users.xan }),
      },
      pia: {
        open: await copy(users.pia, "pia-open", { availability: open }),
        shared: await copy(users.pia, "pia-shared", { availability: open }),
        closed: await copy(users.pia, "pia-closed"),
        private: await copy(users.pia, "pia-private", privately),
      },
    };

    await ctx.db.insert("circles", {
      aggregateId: "circle-pia",
      ownerId: users.pia,
      name: "Pia's table",
      memberships: [
        { id: "m-p", memberId: users.pia, permission: "Admin", joinedAt: now },
        {
          id: "m-c",
          memberId: users.cid,
          permission: "ViewOnly",
          joinedAt: now,
        },
      ],
      createdAt: now,
    });
    for (const memberId of [users.pia, users.cid]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId: "circle-pia",
        memberId,
      });
    }
    await ctx.db.insert("circleCopyShares", {
      circleId: "circle-pia",
      copyId: "pia-shared",
      sharedAt: now,
    });
    await ctx.db.insert("exchanges", {
      aggregateId: "exch-pia-private",
      initiatorId: users.xan,
      recipientId: users.pia,
      type: "trade",
      requestedPuzzleId: copies.pia.private,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    });

    const collections = {} as Record<Owner, Id<"collections">>;
    for (const owner of OWNERS) {
      const collectionId = await ctx.db.insert("collections", {
        userId: users[owner],
        name: `${owner}'s shelf`,
        visibility: "public",
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      for (const ownedPuzzleId of Object.values(copies[owner])) {
        await ctx.db.insert("collectionMembers", {
          collectionId,
          ownedPuzzleId,
          addedAt: now,
        });
      }
      collections[owner] = collectionId;
    }
    return { users, copies, collections };
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

// The per-copy truth: every copy of `owner` the single-copy gate lets `viewer` see.
const gateAllows = (t: T, w: World, viewer: Viewer, owner: Owner) =>
  t.run(async (ctx) => {
    const allowed: string[] = [];
    for (const copyId of Object.values(w.copies[owner])) {
      const copy = await ctx.db.get(copyId);
      if (copy && (await canViewCopy(ctx, w.users[viewer], copy))) {
        allowed.push(copyId);
      }
    }
    return allowed.sort();
  });

const sorted = (rows: { _id: string }[]) => rows.map((r) => r._id).sort();

let t: T;
let w: World;

beforeAll(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("bulk copy reads match the per-copy gate", () => {
  test("the world exercises every rule of the gate", async () => {
    const c = w.copies;
    expect(await gateAllows(t, w, "sam", "olive")).toEqual([c.olive.open]);
    expect(await gateAllows(t, w, "sam", "pia")).toEqual([]);
    expect(await gateAllows(t, w, "hal", "olive")).toEqual(
      Object.values(c.olive).sort(),
    );
    expect(await gateAllows(t, w, "mia", "pia")).toEqual(
      [c.pia.open, c.pia.shared, c.pia.closed].sort(),
    );
    expect(await gateAllows(t, w, "bea", "olive")).toEqual([]);
    expect(await gateAllows(t, w, "cid", "pia")).toEqual([c.pia.shared]);
    expect(await gateAllows(t, w, "xan", "olive")).toEqual(
      [c.olive.open, c.olive.heldByXan].sort(),
    );
    expect(await gateAllows(t, w, "xan", "pia")).toEqual([c.pia.private]);
  });

  for (const viewer of VIEWERS) {
    for (const owner of OWNERS) {
      test(`${viewer} reading ${owner}'s library and public collection`, async () => {
        const expected = await gateAllows(t, w, viewer, owner);

        const library = await as(t, viewer).query(
          api.library.getOwnedPuzzlesByOwner.getOwnedPuzzlesByOwner,
          { ownerId: w.users[owner], includeUnavailable: true },
        );
        expect(sorted(library)).toEqual(expected);

        const collection = await as(t, viewer).query(
          api.library.getCollectionById.getCollectionById,
          { collectionId: w.collections[owner] },
        );
        expect(sorted(collection?.puzzles ?? [])).toEqual(expected);
      });
    }
  }
});
