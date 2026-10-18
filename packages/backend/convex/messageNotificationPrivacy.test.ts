import { renderEmail } from "@jigswap/email";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { pushTextOf } from "./notifications/copy";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A DM sender's message_received notification follows the same privacy rule as the thread itself
// (self / public / mutual follower): a PRIVATE, non-mutual sender stays anonymous in the bell, the
// push text and the email. Not "Former member" either — they are a living member, so the copy is
// the generic, nameless one. A public sender is still named.

const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const flushScheduled = async (t: TestConvex<typeof schema>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mk = (clerkId: string, extra: Partial<Doc<"users">>) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const priya = await mk("clerk_priya", {
      name: "Priya Hiddenname",
      username: "priyahidden",
      slug: "priya-slug",
    });
    const pat = await mk("clerk_pat", {
      name: "Pat Publicname",
      username: "patpublic",
    });
    const nora = await mk("clerk_nora", { name: "Nora" });
    await ctx.db.insert("profiles", {
      memberId: priya,
      visibility: "private",
      displayName: "Priya Display",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: pat,
      visibility: "public",
      updatedAt: now,
    });
    return { priya, pat, nora };
  });

const as = (t: TestConvex<typeof schema>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });

// Open a real DM while the pair follow each other, then drop both follows: the existing pair thread
// keeps them connected (ConnectionPolicy), but they are no longer mutual — so a private sender is
// anonymous to the recipient. Then the sender posts and the notification subscriber runs.
const dmFrom = async (
  t: TestConvex<typeof schema>,
  sender: { id: Id<"users">; clerkId: string },
  recipient: Id<"users">,
) => {
  const followIds = await t.run(async (ctx) => [
    await ctx.db.insert("follows", {
      followerId: sender.id,
      followeeId: recipient,
      createdAt: 1,
    }),
    await ctx.db.insert("follows", {
      followerId: recipient,
      followeeId: sender.id,
      createdAt: 2,
    }),
  ]);
  const threadId = await as(t, sender.clerkId).mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: recipient },
  );
  await t.run(async (ctx) => {
    for (const id of followIds) await ctx.db.delete(id);
  });
  await tick();
  await as(t, sender.clerkId).mutation(
    api.conversation.postMessage.postMessage,
    { threadId, kind: "text", body: "Still have the Ravensburger?" },
  );
  await flushScheduled(t);
  const rows = await t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", recipient))
      .collect(),
  );
  const row = rows.find((r) => r.type === "message_received");
  if (!row) throw new Error("expected a message_received notification");
  return row;
};

// Everything the recipient receives for one notification: the bell page, the resolved delivery,
// the push text and the email in both locales.
const recipientPayloads = async (
  t: TestConvex<typeof schema>,
  row: Doc<"notifications">,
) => {
  const page = await as(t, "clerk_nora").query(
    api.notifications.listMyNotificationViews.listMyNotificationViews,
    { paginationOpts: { numItems: 20, cursor: null } },
  );
  const content = await t.query(
    internal.notifications.resolveForDelivery.resolveForDelivery,
    {
      recipientId: row.userId,
      type: row.type,
      ...(row.params !== undefined ? { params: row.params } : {}),
      ...(row.relatedId !== undefined ? { relatedId: row.relatedId } : {}),
      ...(row.actorIds?.[0] !== undefined ? { actorId: row.actorIds[0] } : {}),
      ...(row.subject !== undefined ? { subject: row.subject } : {}),
    },
  );
  if (!content) throw new Error("expected delivery content");
  const push = pushTextOf("message_received", content);
  const emails = await Promise.all(
    (["en", "nl"] as const).map((locale) =>
      renderEmail({
        type: "message_received",
        params: content.params,
        locale,
        baseUrl: "https://jigswap.test",
        relatedId: row.relatedId,
        href: content.href,
        actorAnonymous: content.actorAnonymous,
      }),
    ),
  );
  return { page, content, push, emails };
};

describe("message_received sender privacy", () => {
  test("a private, non-mutual DM sender is never identified to the recipient", async () => {
    const t = convexTest(schema, modules);
    const { priya, nora } = await seed(t);
    const row = await dmFrom(t, { id: priya, clerkId: "clerk_priya" }, nora);

    // Defence in depth: the stored snapshot never carries the sender's name.
    expect(JSON.stringify(row.params ?? {})).not.toMatch(/Priya/);

    const payloads = await recipientPayloads(t, row);
    const json = JSON.stringify(payloads);
    for (const secret of [
      priya as string,
      "Priya",
      "Hiddenname",
      "priyahidden",
      "priya-slug",
    ]) {
      expect(json).not.toContain(secret);
    }
    // A living member, not a former one.
    expect(json).not.toMatch(/Former member|Voormalig lid/);

    const view = payloads.page.page[0];
    expect(view.type).toBe("message_received");
    expect(view.actors).toEqual([{ anonymous: true }]);
    expect(view.href).toBe(`/messages/${row.relatedId}`);
    expect(payloads.content.actorAnonymous).toBe(false);
    expect(payloads.content.params).not.toHaveProperty("actorName");
    expect(payloads.push).toEqual({
      title: "New message",
      message: "You have a new message",
    });
    expect(payloads.emails.map((e) => e.fromName)).toEqual([
      "JigSwap",
      "JigSwap",
    ]);
  });

  test("control: a public DM sender is still named", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);

    const payloads = await recipientPayloads(t, row);
    const view = payloads.page.page[0];
    expect(view.actors[0]).toMatchObject({
      anonymous: false,
      memberId: pat,
      name: "Pat Publicname",
    });
    expect(payloads.push.title).toBe("New message from Pat Publicname");
    expect(payloads.emails[0].subject).toBe(
      "New message from Pat Publicname on JigSwap",
    );
    expect(payloads.emails[0].fromName).toBe("Pat Publicname | JigSwap");
  });
});
