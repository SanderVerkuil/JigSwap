import { EMAIL_ELIGIBLE_TYPES } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { MAX_CONFIRM_NAME_LENGTH } from "./sharing/deleteCircle";
import { PURGE_BATCH_SIZE } from "./sharing/purgeDeletedCircle";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Circle deletion: only the owner, by typing the circle's exact name. The circle, its memberships
// and its invites go in the deleting transaction; its copy-share links are purged by a scheduled,
// self-rescheduling job.

type T = TestConvex<typeof schema>;
type Who = "alice" | "bob" | "carol" | "dave";

const NAME = "Saturday Puzzlers";

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

// Alice owns the circle; Bob is an Admin, Carol a ViewOnly member; Dave is an outsider Alice may
// contact. Every profile is PRIVATE, so another member's copy is reachable only through the circle.
const seed = async (t: T) => {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = async (who: Who) => {
      const id = await ctx.db.insert("users", {
        clerkId: `clerk_${who}`,
        email: `${who}@example.com`,
        name: who[0].toUpperCase() + who.slice(1),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("profiles", {
        memberId: id,
        visibility: "private",
        updatedAt: now,
      });
      return id;
    };
    const alice = await mk("alice");
    const dave = await mk("dave");
    for (const [a, b] of [
      [alice, dave],
      [dave, alice],
    ]) {
      await ctx.db.insert("follows", {
        followerId: a,
        followeeId: b,
        createdAt: now,
      });
    }
    return { alice, bob: await mk("bob"), carol: await mk("carol"), dave };
  });
  const circleId = (await as(t, "alice").mutation(
    api.sharing.createCircle.createCircle,
    { name: NAME },
  )) as string;
  for (const [memberId, permission] of [
    [ids.bob, "Admin"],
    [ids.carol, "ViewOnly"],
  ] as const) {
    await as(t, "alice").mutation(internal.sharing.addMember.addMember, {
      circleId,
      memberId,
      permission,
    });
  }
  return { ...ids, circleId };
};

// Alice acquires a copy, marks it OPEN (forLend) and shares it into the circle: the circle is then
// the only way Carol reaches it.
const shareAlicesCopy = async (t: T, circleId: string) => {
  const puzzleId = await t.run(async (ctx) => {
    const now = Date.now();
    const aggregateId = crypto.randomUUID();
    const owner = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_alice"))
      .unique();
    await ctx.db.insert("puzzles", {
      aggregateId,
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      searchableText: "Mountain Vista Ravensburger",
      status: "approved",
      submittedBy: owner!._id,
      createdAt: now,
      updatedAt: now,
    });
    return aggregateId;
  });
  const copyId = (await as(t, "alice").mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: puzzleId, condition: "good" },
  )) as string;
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
      .unique();
    await ctx.db.patch(row!._id, {
      availability: { forTrade: false, forSale: false, forLend: true },
    });
  });
  await as(t, "alice").mutation(
    api.sharing.shareCopyToCircle.shareCopyToCircle,
    { circleId, copyId },
  );
  return copyId;
};

const inviteDave = (t: T, circleId: string, dave: Id<"users">) =>
  as(t, "alice").mutation(api.sharing.inviteToCircle.inviteToCircle, {
    circleId,
    inviteeId: dave,
    permission: "ViewOnly",
  }) as Promise<string>;

// Seed `count` DECIDED invites to the circle directly (declined, from Alice to Dave): they pile up
// over a circle's life and are only purged in batches.
const seedDecidedInvites = (
  t: T,
  circleId: string,
  inviterId: Id<"users">,
  inviteeId: Id<"users">,
  count: number,
) =>
  t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("circleInvites", {
        aggregateId: `decided-${i}`,
        circleAggregateId: circleId,
        inviteeId,
        inviterId,
        permission: "ViewOnly",
        status: "declined",
        createdAt: i,
        expiresAt: i + 1,
        decidedAt: i + 1,
      });
    }
  });

const deleteCircle = (t: T, who: Who, circleId: string, confirmName = NAME) =>
  as(t, who).mutation(api.sharing.deleteCircle.deleteCircle, {
    circleId,
    confirmName,
  });

// Everything stored under the circle, per table.
const rowsOf = (t: T, circleId: string) =>
  t.run(async (ctx) => ({
    circles: await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
      .collect(),
    circleMembers: await ctx.db
      .query("circleMembers")
      .withIndex("by_circle", (q) => q.eq("circleAggregateId", circleId))
      .collect(),
    circleInvites: await ctx.db
      .query("circleInvites")
      .withIndex("by_circle_invitee", (q) =>
        q.eq("circleAggregateId", circleId),
      )
      .collect(),
    circleCopyShares: await ctx.db
      .query("circleCopyShares")
      .withIndex("by_circle", (q) => q.eq("circleId", circleId))
      .collect(),
  }));

const deletedEvents = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("domainEvents")
      .withIndex("by_name", (q) => q.eq("name", "CircleDeleted"))
      .collect(),
  );

const flushScheduled = async (t: T) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const carolBrowses = async (t: T) =>
  (
    await as(t, "carol").query(
      api.library.browseOwnedPuzzles.browseOwnedPuzzles,
      {},
    )
  ).ownedPuzzles.map((c) => c.aggregateId);

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const errorDataOf = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the mutation to fail");
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(ConvexError);
      const data = (e as ConvexError<Value>).data;
      return (typeof data === "string" ? JSON.parse(data) : data) as {
        code?: string;
        message?: string;
      };
    },
  );

describe("sharing.deleteCircle", () => {
  test("the owner deletes: circle, memberships and pending invites go at once, the rest after the purge", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, dave, circleId } = await seed(t);
    await shareAlicesCopy(t, circleId);
    await inviteDave(t, circleId, dave);
    await seedDecidedInvites(t, circleId, alice, dave, 1);
    const before = await rowsOf(t, circleId);
    expect(before.circleMembers).toHaveLength(3);
    expect(before.circleInvites).toHaveLength(2);
    expect(before.circleCopyShares).toHaveLength(1);

    await deleteCircle(t, "alice", circleId);

    const after = await rowsOf(t, circleId);
    expect(after.circles).toHaveLength(0);
    expect(after.circleMembers).toHaveLength(0);
    // Only the decided invite is left for the purge.
    expect(after.circleInvites.map((i) => i.status)).toEqual(["declined"]);

    const events = await deletedEvents(t);
    expect(events).toHaveLength(1);
    expect(events[0].context).toBe("sharing");
    expect(events[0].payload).toEqual({
      circleId,
      ownerId: alice,
      memberIds: [bob, carol],
      circleName: NAME,
    });

    await flushScheduled(t);
    const purged = await rowsOf(t, circleId);
    expect(purged.circleCopyShares).toHaveLength(0);
    expect(purged.circleInvites).toHaveLength(0);
  });

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    await expect(
      t.mutation(api.sharing.deleteCircle.deleteCircle, {
        circleId,
        confirmName: NAME,
      }),
    ).rejects.toThrow();
  });

  for (const who of ["bob", "carol"] as const) {
    test(`a non-owner member (${who}) gets NotCircleOwner and nothing changes`, async () => {
      const t = convexTest(schema, modules);
      const { circleId } = await seed(t);

      expect((await errorDataOf(deleteCircle(t, who, circleId))).code).toBe(
        "NotCircleOwner",
      );
      expect((await rowsOf(t, circleId)).circleMembers).toHaveLength(3);
      expect(await deletedEvents(t)).toHaveLength(0);
    });
  }

  test("a non-member and an unknown id get the same CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);

    // Even with the wrong name, so a stranger learns nothing about the circle.
    expect(await errorDataOf(deleteCircle(t, "dave", circleId, "x"))).toEqual({
      code: "CircleNotFound",
      message: `Circle ${circleId} could not be found`,
    });
    expect(
      await errorDataOf(deleteCircle(t, "dave", "no-such-circle")),
    ).toEqual({
      code: "CircleNotFound",
      message: "Circle no-such-circle could not be found",
    });
    expect((await rowsOf(t, circleId)).circles).toHaveLength(1);
  });

  for (const confirmName of ["saturday puzzlers", ` ${NAME}`, `${NAME} `, ""]) {
    test(`a confirmName of ${JSON.stringify(confirmName)} is refused and changes nothing`, async () => {
      const t = convexTest(schema, modules);
      const { dave, circleId } = await seed(t);
      await shareAlicesCopy(t, circleId);
      await inviteDave(t, circleId, dave);
      const before = await rowsOf(t, circleId);

      expect(
        (await errorDataOf(deleteCircle(t, "alice", circleId, confirmName)))
          .code,
      ).toBe("ConfirmationMismatch");
      await flushScheduled(t);
      expect(await rowsOf(t, circleId)).toEqual(before);
      expect(await deletedEvents(t)).toHaveLength(0);
    });
  }

  test("former members lose listMyCircles, getCircle and the circle-shared copy at once", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const copyId = await shareAlicesCopy(t, circleId);
    expect(await carolBrowses(t)).toContain(copyId);
    expect(
      await as(t, "carol").query(api.sharing.listMyCircles.listMyCircles, {}),
    ).toHaveLength(1);

    await deleteCircle(t, "alice", circleId);

    // Before the share purge has run: membership is the gate, and it is gone.
    expect((await rowsOf(t, circleId)).circleCopyShares).toHaveLength(1);
    for (const who of ["alice", "bob", "carol"] as const) {
      expect(
        await as(t, who).query(api.sharing.listMyCircles.listMyCircles, {}),
      ).toHaveLength(0);
      expect(
        await as(t, who).query(api.sharing.getCircle.getCircle, { circleId }),
      ).toBeNull();
    }
    expect(await carolBrowses(t)).not.toContain(copyId);
  });

  test("a pending invite can't be accepted afterwards (InviteNotFound) and isn't listed", async () => {
    const t = convexTest(schema, modules);
    const { dave, circleId } = await seed(t);
    const inviteId = await inviteDave(t, circleId, dave);

    await deleteCircle(t, "alice", circleId);

    expect(
      (
        await errorDataOf(
          as(t, "dave").mutation(
            api.sharing.acceptCircleInvite.acceptCircleInvite,
            { inviteId },
          ),
        )
      ).code,
    ).toBe("InviteNotFound");
    expect(
      await as(t, "dave").query(
        api.sharing.listMyCircleInvites.listMyCircleInvites,
        {},
      ),
    ).toHaveLength(0);
  });

  test("more shares than one batch are purged across batches, and only this circle's", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const total = PURGE_BATCH_SIZE * 2 + 50;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("circleCopyShares", {
          circleId,
          copyId: `copy-${i}`,
          sharedAt: i,
        });
      }
      await ctx.db.insert("circleCopyShares", {
        circleId: "another-circle",
        copyId: "copy-other",
        sharedAt: 0,
      });
    });

    await deleteCircle(t, "alice", circleId);
    expect((await rowsOf(t, circleId)).circleCopyShares).toHaveLength(total);

    // One run takes one batch and leaves the rest for its successor.
    expect(
      await t.mutation(internal.sharing.purgeDeletedCircle.purgeDeletedCircle, {
        circleId,
      }),
    ).toBe(PURGE_BATCH_SIZE);
    expect((await rowsOf(t, circleId)).circleCopyShares).toHaveLength(
      total - PURGE_BATCH_SIZE,
    );

    await flushScheduled(t);
    expect((await rowsOf(t, circleId)).circleCopyShares).toHaveLength(0);
    expect((await rowsOf(t, "another-circle")).circleCopyShares).toHaveLength(
      1,
    );
  });

  test("more decided invites than one batch: the delete still commits, the purge clears them across batches", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    const total = PURGE_BATCH_SIZE * 2 + 50;
    await seedDecidedInvites(t, circleId, alice, dave, total);

    await deleteCircle(t, "alice", circleId);
    expect((await rowsOf(t, circleId)).circleInvites).toHaveLength(total);

    expect(
      await t.mutation(internal.sharing.purgeDeletedCircle.purgeDeletedCircle, {
        circleId,
      }),
    ).toBe(PURGE_BATCH_SIZE);
    expect((await rowsOf(t, circleId)).circleInvites).toHaveLength(
      total - PURGE_BATCH_SIZE,
    );

    await flushScheduled(t);
    expect((await rowsOf(t, circleId)).circleInvites).toHaveLength(0);
  });

  test("the purge leaves a circle that still exists untouched", async () => {
    const t = convexTest(schema, modules);
    const { alice, dave, circleId } = await seed(t);
    await shareAlicesCopy(t, circleId);
    await seedDecidedInvites(t, circleId, alice, dave, 1);
    const before = await rowsOf(t, circleId);

    expect(
      await t.mutation(internal.sharing.purgeDeletedCircle.purgeDeletedCircle, {
        circleId,
      }),
    ).toBe(0);
    await flushScheduled(t);
    expect(await rowsOf(t, circleId)).toEqual(before);
  });

  test("a confirmName over the cap is refused as ConfirmationMismatch, for anyone, without reads", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const tooLong = NAME + "x".repeat(MAX_CONFIRM_NAME_LENGTH);
    expect(MAX_CONFIRM_NAME_LENGTH).toBe(1000);

    for (const [who, id] of [
      ["alice", circleId],
      ["dave", circleId],
      ["dave", "no-such-circle"],
    ] as const) {
      expect((await errorDataOf(deleteCircle(t, who, id, tooLong))).code).toBe(
        "ConfirmationMismatch",
      );
    }
    expect((await rowsOf(t, circleId)).circles).toHaveLength(1);
    expect(await deletedEvents(t)).toHaveLength(0);
  });

  test("a circle stored with a name over the create-side cap can still be deleted", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const longName = "L".repeat(150);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("circles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
        .unique();
      if (row) await ctx.db.patch(row._id, { name: longName });
    });

    await deleteCircle(t, "alice", circleId, longName);
    expect((await rowsOf(t, circleId)).circles).toHaveLength(0);
  });

  test("a second delete answers CircleNotFound", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    await deleteCircle(t, "alice", circleId);

    expect((await errorDataOf(deleteCircle(t, "alice", circleId))).code).toBe(
      "CircleNotFound",
    );
    expect(await deletedEvents(t)).toHaveLength(1);
  });

  test("members linked only by the circle can no longer message each other", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    const canMessage = (who: Who, recipientId: Id<"users">) =>
      as(t, who).query(api.conversation.canMessage.canMessage, {
        recipientId,
      });
    // Precondition: no follow edge and no thread between Bob and Carol, only the circle.
    expect(await canMessage("bob", carol)).toBe(true);
    expect(await canMessage("carol", bob)).toBe(true);

    await deleteCircle(t, "alice", circleId);

    expect(await canMessage("bob", carol)).toBe(false);
    expect(await canMessage("carol", bob)).toBe(false);
  });

  test("global search stops returning the circle; it never surfaces the shared copy", async () => {
    const t = convexTest(schema, modules);
    const { circleId } = await seed(t);
    const copyId = await shareAlicesCopy(t, circleId);
    const search = async (who: Who, term: string) =>
      as(t, who).query(api.search.globalSearch.global, { term });
    const mentionsCopy = (results: unknown) =>
      JSON.stringify(results).includes(copyId);

    for (const who of ["bob", "carol"] as const) {
      const before = await search(who, "saturday");
      expect(before.circles.map((c) => c.name)).toEqual([NAME]);
      expect(mentionsCopy(await search(who, "mountain"))).toBe(false);
    }

    await deleteCircle(t, "alice", circleId);

    for (const who of ["bob", "carol"] as const) {
      expect((await search(who, "saturday")).circles).toEqual([]);
      const puzzles = await search(who, "mountain");
      expect(mentionsCopy(puzzles)).toBe(false);
      // Only the public catalog entry can match, never a copy page.
      for (const p of puzzles.puzzles) expect(p.href).toMatch(/^\/puzzles\//);
    }
  });

  test("sharing/purgeDeletedCircle is internal, never client-callable", () => {
    // @ts-expect-error purgeDeletedCircle is an internalMutation, so the public api must not expose it
    void api.sharing.purgeDeletedCircle.purgeDeletedCircle;
    expect(
      internal.sharing.purgeDeletedCircle.purgeDeletedCircle,
    ).toBeDefined();
  });
});

describe("circle_deleted notifications", () => {
  const notificationsOf = (t: T, userId: Id<"users">) =>
    t.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    );

  test("every member but the owner is told neutrally, with the name snapshotted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, carol, dave, circleId } = await seed(t);
    await inviteDave(t, circleId, dave);
    await flushScheduled(t);
    // Dave's invite notification is the only row before the deletion.
    expect(await notificationsOf(t, dave)).toHaveLength(1);

    await deleteCircle(t, "alice", circleId);
    await flushScheduled(t);

    for (const member of [bob, carol]) {
      const rows = (await notificationsOf(t, member)).filter(
        (row) => row.type === "circle_deleted",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        relatedId: circleId,
        params: { circleName: NAME },
        subject: { kind: "circle", circleId },
      });
      expect(rows[0].actorIds ?? []).toEqual([]);
    }
    expect(await notificationsOf(t, alice)).toHaveLength(0);
    // The pending invitee is not told.
    expect(
      (await notificationsOf(t, dave)).map((row) => row.type),
    ).not.toContain("circle_deleted");

    const views = (
      await as(t, "carol").query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 20, cursor: null } },
      )
    ).page.filter((view) => view.type === "circle_deleted");
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      actors: [],
      context: { circleName: NAME },
      href: "/circles",
      state: "unavailable",
    });
  });

  test("a member who left before the deletion is not told", async () => {
    const t = convexTest(schema, modules);
    const { bob, carol, circleId } = await seed(t);
    await as(t, "carol").mutation(api.sharing.leaveCircle.leaveCircle, {
      circleId,
    });

    await deleteCircle(t, "alice", circleId);
    await flushScheduled(t);

    const types = async (id: Id<"users">) =>
      (await notificationsOf(t, id)).map((row) => row.type);
    expect(await types(bob)).toContain("circle_deleted");
    expect(await types(carol)).not.toContain("circle_deleted");
    expect((await deletedEvents(t))[0].payload.memberIds).toEqual([bob]);
  });

  test("push delivery carries the snapshotted name (in-app/push only, never email)", async () => {
    const t = convexTest(schema, modules);
    const { bob, circleId } = await seed(t);
    await deleteCircle(t, "alice", circleId);

    const delivery = await t.query(
      internal.notifications.resolveForDelivery.resolveForDelivery,
      {
        recipientId: bob,
        type: "circle_deleted",
        relatedId: circleId,
        params: { circleName: NAME },
        subject: { kind: "circle", circleId },
      },
    );
    expect(delivery?.params.circleName).toBe(NAME);
    expect(delivery?.href).toBe("/circles");
    expect(EMAIL_ELIGIBLE_TYPES.has("circle_deleted")).toBe(false);
  });
});
