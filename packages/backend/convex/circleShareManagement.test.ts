import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { SHARE_STATE_SCAN_CAP } from "./sharing/listMyCircleShareState";
import { MAX_SHARE_BATCH } from "./sharing/shareCopiesToCircle";

// Managing one's own circle shares (UX-41): share a selection of copies in one call, take a share
// back, and read which of your copies are shared where. Every function gates itself: the caller
// must be signed in, must own each copy (one generic CopyNotFound otherwise) and must be a member
// of the circle (CircleNotFound otherwise, as for an unknown circle). Sharing needs a seat that may
// exchange; taking your own share back does not. Every profile is PRIVATE and nobody follows
// anybody, so only the circle share can reveal a copy to another member.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const OPEN = { forTrade: true, forSale: false, forLend: false };

const mkUser = (t: T, clerkId: string) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: id,
      displayName: clerkId,
      visibility: "private",
      updatedAt: now,
    });
    return id;
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

const dataOf = (e: unknown): { code?: string } => {
  const data = (e as ConvexError<Value>).data;
  return typeof data === "string"
    ? JSON.parse(data)
    : (data as { code?: string });
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect(dataOf(error).code).toBe(code);
};

// An open copy of `title` owned by `ownerId`; returns its Library CopyId (aggregateId).
const mkCopy = (
  t: T,
  ownerId: Id<"users">,
  title: string,
  extra: Partial<Doc<"ownedPuzzles">> = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: `def-${title}`,
      title,
      pieceCount: 1000,
      status: "approved",
      submittedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const copyId = `copy-${title}`;
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyId,
      puzzleId,
      ownerId,
      condition: "good",
      availability: OPEN,
      createdAt: now,
      updatedAt: now,
      ...extra,
    });
    return copyId;
  });

const sharesOf = (t: T, circleId: string) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("circleCopyShares")
        .withIndex("by_circle", (q) => q.eq("circleId", circleId))
        .collect()
    )
      .map((share) => share.copyId)
      .sort(),
  );

const share = (t: T, clerkId: string, circleId: string, copyIds: string[]) =>
  as(t, clerkId).mutation(api.sharing.shareCopiesToCircle.shareCopiesToCircle, {
    circleId,
    copyIds,
  });

const unshare = (t: T, clerkId: string, circleId: string, copyId: string) =>
  as(t, clerkId).mutation(
    api.sharing.unshareCopyFromCircle.unshareCopyFromCircle,
    { circleId, copyId },
  );

const sharedTitles = async (t: T, clerkId: string, circleId: string) =>
  (
    await as(t, clerkId).query(
      api.sharing.listCircleSharedCopies.listCircleSharedCopies,
      { circleId },
    )
  )
    .map((card) => card.title)
    .sort();

// Alice owns "Puzzle Club"; Bob may exchange, Carol is View only, Dave is outside it.
const seed = async (t: T) => {
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  const carol = await mkUser(t, "carol");
  const dave = await mkUser(t, "dave");
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: "Puzzle Club" },
  )) as string;
  for (const [memberId, permission] of [
    [bob, "Exchange"],
    [carol, "ViewOnly"],
  ] as const) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission,
    });
  }
  return { alice, bob, carol, dave, circleId };
};

describe("shareCopiesToCircle", () => {
  test("shares a member's selection at once, visible to the other members", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const lighthouse = await mkCopy(t, bob, "Lighthouse");
    const wasgij = await mkCopy(t, bob, "Wasgij");

    expect(await share(t, "bob", circleId, [lighthouse, wasgij])).toEqual({
      shared: 2,
      alreadyShared: 0,
    });
    expect(await sharesOf(t, circleId)).toEqual([lighthouse, wasgij].sort());
    expect(await sharedTitles(t, "carol", circleId)).toEqual([
      "Lighthouse",
      "Wasgij",
    ]);
  });

  test("leaves copies that are already shared as they are (one link each)", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const lighthouse = await mkCopy(t, bob, "Lighthouse");
    const wasgij = await mkCopy(t, bob, "Wasgij");
    await share(t, "bob", circleId, [lighthouse]);

    expect(
      await share(t, "bob", circleId, [lighthouse, wasgij, wasgij]),
    ).toEqual({ shared: 1, alreadyShared: 1 });
    expect(await sharesOf(t, circleId)).toEqual([lighthouse, wasgij].sort());
  });

  test("refuses a View only member and shares nothing", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId } = await seed(t);
    const copy = await mkCopy(t, carol, "Lighthouse");

    await expectCode(share(t, "carol", circleId, [copy]), "CannotShareCopy");
    expect(await sharesOf(t, circleId)).toEqual([]);
  });

  test("tells a non-member and an unknown circle the same CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    const copy = await mkCopy(t, dave, "Lighthouse");

    await expectCode(share(t, "dave", circleId, [copy]), "CircleNotFound");
    await expectCode(
      share(t, "dave", "no-such-circle", [copy]),
      "CircleNotFound",
    );
    expect(await sharesOf(t, circleId)).toEqual([]);
  });

  test("shares nothing when one copy isn't the caller's (one CopyNotFound for missing or someone else's)", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const mine = await mkCopy(t, bob, "Lighthouse");
    const hers = await mkCopy(t, alice, "Wasgij");

    await expectCode(share(t, "bob", circleId, [mine, hers]), "CopyNotFound");
    await expectCode(
      share(t, "bob", circleId, [mine, "copy-nope"]),
      "CopyNotFound",
    );
    expect(await sharesOf(t, circleId)).toEqual([]);
  });

  test(`refuses more than ${MAX_SHARE_BATCH} copies in one call`, async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const ids = Array.from({ length: MAX_SHARE_BATCH + 1 }, (_, i) => `c${i}`);

    await expectCode(share(t, "bob", circleId, ids), "BatchTooLarge");
  });

  test("needs a signed-in member", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);

    await expect(
      t.mutation(api.sharing.shareCopiesToCircle.shareCopiesToCircle, {
        circleId,
        copyIds: [],
      }),
    ).rejects.toThrow();
  });
});

describe("unshareCopyFromCircle", () => {
  test("takes the share back in that circle only; members no longer see it", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const lighthouse = await mkCopy(t, bob, "Lighthouse");
    const wasgij = await mkCopy(t, bob, "Wasgij");
    const otherCircle = (await as(t, "bob").mutation(
      api.sharing.createCircle.createCircle,
      { name: "Bob's friends" },
    )) as string;
    await as(t, "bob").mutation(internal.sharing.addMember.addMember, {
      circleId: otherCircle,
      memberId: alice,
      permission: "ViewOnly",
    });
    await share(t, "bob", circleId, [lighthouse, wasgij]);
    await share(t, "bob", otherCircle, [lighthouse]);

    await unshare(t, "bob", circleId, lighthouse);

    expect(await sharesOf(t, circleId)).toEqual([wasgij]);
    expect(await sharedTitles(t, "alice", circleId)).toEqual(["Wasgij"]);
    expect(await sharesOf(t, otherCircle)).toEqual([lighthouse]);
  });

  test("lets an owner whose seat dropped to View only take their own share back", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const copy = await mkCopy(t, bob, "Lighthouse");
    await share(t, "bob", circleId, [copy]);
    await as(t, "alice").mutation(
      api.sharing.changePermission.changePermission,
      { circleId, memberId: bob, permission: "ViewOnly" },
    );

    await expectCode(share(t, "bob", circleId, [copy]), "CannotShareCopy");
    await unshare(t, "bob", circleId, copy);
    expect(await sharesOf(t, circleId)).toEqual([]);
  });

  test("only the copy's owner may take a share back, even an Admin may not", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const copy = await mkCopy(t, bob, "Lighthouse");
    await share(t, "bob", circleId, [copy]);

    await expectCode(unshare(t, "alice", circleId, copy), "CopyNotFound");
    await expectCode(unshare(t, "bob", circleId, "copy-nope"), "CopyNotFound");
    expect(await sharesOf(t, circleId)).toEqual([copy]);
  });

  test("tells a non-member CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    const copy = await mkCopy(t, dave, "Lighthouse");

    await expectCode(unshare(t, "dave", circleId, copy), "CircleNotFound");
  });
});

describe("listMyCircleShareState", () => {
  test("lists which of the viewer's own copies are shared in the circle", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, circleId } = await seed(t);
    const lighthouse = await mkCopy(t, bob, "Lighthouse");
    await mkCopy(t, bob, "Wasgij");
    const hers = await mkCopy(t, alice, "Ravensburger");
    await share(t, "bob", circleId, [lighthouse]);
    await share(t, "alice", circleId, [hers]);

    expect(
      await as(t, "bob").query(
        api.sharing.listMyCircleShareState.listMyCircleShareState,
        { circleId },
      ),
    ).toEqual([lighthouse]);
  });

  test("tells a non-member CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);

    await expectCode(
      as(t, "dave").query(
        api.sharing.listMyCircleShareState.listMyCircleShareState,
        { circleId },
      ),
      "CircleNotFound",
    );
  });

  test(`probes at most the viewer's newest ${SHARE_STATE_SCAN_CAP} copies`, async () => {
    // The cap bounds the read for a very large library: an older copy past it reads as not shared
    // (re-sharing it is harmless: shareCopiesToCircle counts it as already shared).
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    const oldest = await mkCopy(t, bob, "Oldest");
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", oldest))
        .unique();
      if (!row) throw new Error("setup: the oldest copy is missing");
      for (let i = 0; i < SHARE_STATE_SCAN_CAP; i++) {
        await ctx.db.insert("ownedPuzzles", {
          aggregateId: `copy-newer-${i}`,
          puzzleId: row.puzzleId,
          ownerId: bob,
          condition: "good",
          availability: OPEN,
          createdAt: i,
          updatedAt: i,
        });
      }
    });
    await share(t, "bob", circleId, [oldest, "copy-newer-0"]);

    expect(
      await as(t, "bob").query(
        api.sharing.listMyCircleShareState.listMyCircleShareState,
        { circleId },
      ),
    ).toEqual(["copy-newer-0"]);
  });
});

describe("getCopyCircleShares", () => {
  test("lists the owner's circles with whether the copy is shared and whether they may share", async () => {
    const t = convexTest(schema, modules);
    const { carol, circleId } = await seed(t);
    const copy = await mkCopy(t, carol, "Lighthouse");
    const own = (await as(t, "carol").mutation(
      api.sharing.createCircle.createCircle,
      { name: "Carol's club" },
    )) as string;
    await share(t, "carol", own, [copy]);

    const rows = await as(t, "carol").query(
      api.sharing.getCopyCircleShares.getCopyCircleShares,
      { copyId: copy },
    );
    expect(rows).toEqual([
      {
        circleId: own,
        name: "Carol's club",
        memberCount: 1,
        viewerPermission: "Admin",
        shared: true,
        canShare: true,
      },
      {
        circleId,
        name: "Puzzle Club",
        memberCount: 3,
        viewerPermission: "ViewOnly",
        shared: false,
        canShare: false,
      },
    ]);
  });

  test("answers null for someone else's copy and for an unknown one", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    const copy = await mkCopy(t, bob, "Lighthouse");

    for (const [clerkId, copyId] of [
      ["alice", copy],
      ["bob", "copy-nope"],
    ]) {
      expect(
        await as(t, clerkId).query(
          api.sharing.getCopyCircleShares.getCopyCircleShares,
          { copyId },
        ),
      ).toBeNull();
    }
  });
});
