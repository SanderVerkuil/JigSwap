import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Admin review notifications: ChangeProposalFiled and PuzzleDefinitionSubmitted fan out to every
// admin (excluding the acting member) so there is an inbox for "things awaiting review". Editing a
// pending proposal must NOT notify (the review queue already reflects edits live).

const seedMembers = async (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string, role?: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        role,
        createdAt: now,
        updatedAt: now,
      });
    return {
      alice: await mkUser("clerk_alice", "Alice"),
      bob: await mkUser("clerk_bob", "Bob"),
      // The role mirror must be written explicitly on the seeded row — asAdmin below only
      // impersonates the JWT claim, it never touches this row, and the fan-out reads the mirror
      // via by_role.
      admin: await mkUser("clerk_admin", "Admin", "admin"),
      // A second admin, used as a positive control in the actor-exclusion test: it proves
      // the fan-out actually fired (admin2 gets notified) rather than the whole dispatch
      // silently no-oping, while confirming the acting admin specifically was dropped.
      admin2: await mkUser("clerk_admin2", "Admin Two", "admin"),
    };
  });

const asAlice = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asBob = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_bob" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_admin", metadata: { role: "admin" } });

// Submit (as alice) + approve (as admin), returning an APPROVED definition's aggregateId.
const submitApproved = async (t: TestConvex<typeof schema>) => {
  const id = await asAlice(t).mutation(
    api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
    { title: "Mountain Vista", pieceCount: 1000 },
  );
  await asAdmin(t).mutation(
    api.catalog.approvePuzzleDefinition.approvePuzzleDefinition,
    { puzzleDefinitionId: id as string },
  );
  return id as string;
};

const fileAsBob = async (t: TestConvex<typeof schema>) => {
  const definitionId = await submitApproved(t);
  const proposalId = await asBob(t).mutation(
    api.catalog.proposeDefinitionChange.proposeDefinitionChange,
    {
      puzzleDefinitionId: definitionId,
      title: "Mountain Vista (Panorama)",
      pieceCount: 500,
    },
  );
  return { definitionId, proposalId: proposalId as string };
};

// Drain the async event dispatcher: yield a macrotask so the pending runAfter(0) job fires,
// then await any in-progress jobs — looped a few times to settle the chain.
const flushScheduled = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const notificationsFor = (t: TestConvex<typeof schema>, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );

describe("admin review notifications", () => {
  test("filing a proposal notifies the admin, not the proposer or another member", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, admin } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    const isFiled = (n: { type: string }) => n.type === "admin_proposal_filed";
    const adminNotifications = (await notificationsFor(t, admin)).filter(
      isFiled,
    );
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0]?.params?.puzzleTitle).toBe("Mountain Vista");
    expect(adminNotifications[0]?.relatedId).toBe(proposalId);

    expect((await notificationsFor(t, bob)).filter(isFiled)).toEqual([]);
    expect((await notificationsFor(t, alice)).filter(isFiled)).toEqual([]);
  });

  test("submitting a definition notifies the admin, not the submitter", async () => {
    const t = convexTest(schema, modules);
    const { bob, admin } = await seedMembers(t);
    await asBob(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Desert Ruins", pieceCount: 750 },
    );
    await flushScheduled(t);

    const isSubmitted = (n: { type: string }) =>
      n.type === "admin_definition_submitted";
    const adminNotifications = (await notificationsFor(t, admin)).filter(
      isSubmitted,
    );
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0]?.params?.puzzleTitle).toBe("Desert Ruins");

    expect((await notificationsFor(t, bob)).filter(isSubmitted)).toEqual([]);
  });

  test("actor exclusion: the admin submitting a definition does not self-notify, but another admin does", async () => {
    const t = convexTest(schema, modules);
    const { admin, admin2 } = await seedMembers(t);
    await asAdmin(t).mutation(
      api.catalog.submitPuzzleDefinition.submitPuzzleDefinition,
      { title: "Admin's Own Submission", pieceCount: 300 },
    );
    await flushScheduled(t);

    const isSubmitted = (n: { type: string }) =>
      n.type === "admin_definition_submitted";
    // Positive control: admin2 DID receive it, proving the fan-out fired.
    expect(
      (await notificationsFor(t, admin2)).filter(isSubmitted),
    ).toHaveLength(1);
    // The acting admin specifically was excluded.
    expect((await notificationsFor(t, admin)).filter(isSubmitted)).toEqual([]);
  });

  test("editing a pending proposal produces no admin notification", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    const { proposalId } = await fileAsBob(t);
    await flushScheduled(t);

    const isFiled = (n: { type: string }) => n.type === "admin_proposal_filed";
    expect((await notificationsFor(t, admin)).filter(isFiled)).toHaveLength(1);

    await asBob(t).mutation(api.catalog.editChangeProposal.editChangeProposal, {
      changeProposalId: proposalId,
      title: "Mountain Vista (Wide Panorama)",
    });
    await flushScheduled(t);

    expect((await notificationsFor(t, admin)).filter(isFiled)).toHaveLength(1);
  });
});

// SEC-26 (P-23 Phase A): a flood of submissions or suggestions reaches each admin as one updating
// row per review queue, not one per item, and pushes them about it at most once an hour.
describe("admin review notifications group while unread", () => {
  const submitAs = (who: ReturnType<typeof asBob>, title: string) =>
    who.mutation(api.catalog.submitPuzzleDefinition.submitPuzzleDefinition, {
      title,
      pieceCount: 500,
    });
  const isSubmitted = (n: { type: string }) =>
    n.type === "admin_definition_submitted";
  const isFiled = (n: { type: string }) => n.type === "admin_proposal_filed";
  const viewsOf = async (t: TestConvex<typeof schema>) =>
    (
      await asAdmin(t).query(
        api.notifications.listMyNotificationViews.listMyNotificationViews,
        { paginationOpts: { numItems: 50, cursor: null } },
      )
    ).page;

  test("one member's flood is one row per admin, counting what arrived, and links to the queue", async () => {
    const t = convexTest(schema, modules);
    const { admin, admin2 } = await seedMembers(t);
    for (const title of ["One", "Two", "Three"]) {
      await submitAs(asBob(t), title);
    }
    await flushScheduled(t);

    for (const recipient of [admin, admin2]) {
      const rows = (await notificationsFor(t, recipient)).filter(isSubmitted);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.itemCount).toBe(3);
      expect(rows[0]?.actorCount).toBe(1);
      expect(rows[0]?.isRead).toBe(false);
    }

    const views = (await viewsOf(t)).filter(isSubmitted);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      itemCount: 3,
      state: "informational",
      href: "/admin/moderation",
    });
  });

  test("several members' submissions join the same row, with the newest actor first", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, admin } = await seedMembers(t);
    await submitAs(asAlice(t), "One");
    await submitAs(asBob(t), "Two");
    await flushScheduled(t);

    const [row] = (await notificationsFor(t, admin)).filter(isSubmitted);
    expect(row?.itemCount).toBe(2);
    expect(row?.actorCount).toBe(2);
    expect(row?.actorIds).toEqual([bob, alice]);
  });

  test("a single submission stays a plain row that names and opens that puzzle", async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    await submitAs(asBob(t), "Only One");
    await flushScheduled(t);

    const views = (await viewsOf(t)).filter(isSubmitted);
    expect(views).toHaveLength(1);
    expect(views[0]?.itemCount).toBeUndefined();
    expect(views[0]?.context.puzzleTitle).toBe("Only One");
    expect(views[0]?.href).toContain("/admin/moderation?tab=submissions&item=");
  });

  test("once the admin has read the row, the next item opens a new one", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    await submitAs(asBob(t), "One");
    await submitAs(asBob(t), "Two");
    await flushScheduled(t);
    const [read] = (await viewsOf(t)).filter(isSubmitted);
    await asAdmin(t).mutation(
      api.notifications.markNotificationRead.markNotificationRead,
      { notificationId: read!.id },
    );

    await submitAs(asBob(t), "Three");
    await flushScheduled(t);

    const rows = (await notificationsFor(t, admin)).filter(isSubmitted);
    expect(rows).toHaveLength(2);
    const fresh = rows.find((row) => !row.isRead);
    expect(fresh?.params?.puzzleTitle).toBe("Three");
    expect(fresh?.itemCount).toBeUndefined();
  });

  test("the two queues group apart: a suggestion links to the suggestions list", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    const definitionId = await submitApproved(t);
    await flushScheduled(t);
    for (const who of [asBob(t), asAlice(t)]) {
      await who.mutation(
        api.catalog.proposeDefinitionChange.proposeDefinitionChange,
        { puzzleDefinitionId: definitionId, title: "A better title" },
      );
    }
    await flushScheduled(t);

    const rows = await notificationsFor(t, admin);
    expect(rows.filter(isFiled)).toHaveLength(1);
    expect(rows.filter(isSubmitted)).toHaveLength(1);
    expect(rows.find(isFiled)?.itemCount).toBe(2);

    const [filed] = (await viewsOf(t)).filter(isFiled);
    expect(filed?.href).toBe("/admin/puzzles/proposals");
  });

  test("a flood pushes an admin once an hour, whichever queue it hits, and never emails", async () => {
    const t = convexTest(schema, modules);
    const { admin, admin2 } = await seedMembers(t);
    // Push is opt-in per type, and only goes to a member with a device.
    await asAdmin(t).mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "admin_definition_submitted", channel: "push", enabled: true },
    );
    await asAdmin(t).mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "admin_proposal_filed", channel: "push", enabled: true },
    );
    await t.run((ctx) =>
      ctx.db.insert("pushSubscriptions", {
        userId: admin,
        endpoint: "https://fcm.googleapis.com/fcm/send/admin",
        p256dh: "p",
        auth: "a",
        createdAt: Date.now(),
      }),
    );
    const definitionId = await submitApproved(t);
    await flushScheduled(t);
    await submitAs(asBob(t), "One");
    await submitAs(asBob(t), "Two");
    await submitAs(asAlice(t), "Three");
    await asBob(t).mutation(
      api.catalog.proposeDefinitionChange.proposeDefinitionChange,
      { puzzleDefinitionId: definitionId, title: "A better title" },
    );
    await flushScheduled(t);

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const named = (part: string) =>
      scheduled.filter((job) => job.name.includes(part));
    // Everything above fell in one hour, so the admin's device was pushed once, about the first item.
    // admin2 has no device: their rows are in-app only.
    const pushedTo = named("sendWebPush").map(
      (job) => (job.args[0] as { userId: Id<"users"> }).userId,
    );
    expect(pushedTo.filter((id) => id === admin)).toHaveLength(1);
    expect(pushedTo.filter((id) => id === admin2)).toEqual([]);
    expect(named("sendEmail")).toEqual([]);
  });

  test("the push counter is keyed by the admin alone, so account deletion finds it", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seedMembers(t);
    await asAdmin(t).mutation(
      api.notifications.updateNotificationPreference
        .updateNotificationPreference,
      { type: "admin_definition_submitted", channel: "push", enabled: true },
    );
    await t.run((ctx) =>
      ctx.db.insert("pushSubscriptions", {
        userId: admin,
        endpoint: "https://fcm.googleapis.com/fcm/send/admin",
        p256dh: "p",
        auth: "a",
        createdAt: Date.now(),
      }),
    );
    await submitAs(asBob(t), "One");
    await flushScheduled(t);

    // A "<limit>:<memberId>" key, which the account purge removes by name, not one it can't find.
    const counter = await t.run((ctx) =>
      ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", `adminReviewPush:${admin}`))
        .unique(),
    );
    expect(counter?.count).toBe(1);
  });
});
