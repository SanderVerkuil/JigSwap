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

// Everything the recipient receives for one notification: the bell page, the delivery resolved
// for push and for email, the push text and the email in both locales.
const recipientPayloads = async (
  t: TestConvex<typeof schema>,
  row: Doc<"notifications">,
) => {
  const page = await as(t, "clerk_nora").query(
    api.notifications.listMyNotificationViews.listMyNotificationViews,
    { paginationOpts: { numItems: 20, cursor: null } },
  );
  const resolve = async (channel: "email" | "push") => {
    const content = await t.query(
      internal.notifications.resolveForDelivery.resolveForDelivery,
      {
        recipientId: row.userId,
        type: row.type,
        channel,
        ...(row.params !== undefined ? { params: row.params } : {}),
        ...(row.relatedId !== undefined ? { relatedId: row.relatedId } : {}),
        ...(row.actorIds?.[0] !== undefined
          ? { actorId: row.actorIds[0] }
          : {}),
        ...(row.subject !== undefined ? { subject: row.subject } : {}),
      },
    );
    if (!content) throw new Error("expected delivery content");
    return content;
  };
  const content = await resolve("push");
  const emailContent = await resolve("email");
  const push = pushTextOf("message_received", content);
  const emails = await Promise.all(
    (["en", "nl"] as const).map((locale) =>
      renderEmail({
        type: "message_received",
        params: emailContent.params,
        locale,
        baseUrl: "https://jigswap.test",
        relatedId: row.relatedId,
        href: emailContent.href,
        actorAnonymous: emailContent.actorAnonymous,
      }),
    ),
  );
  return { page, content, emailContent, push, emails };
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
    // The sender line is always the brand; the subject names the sender.
    expect(payloads.emails[0].fromName).toBe("JigSwap");
  });
});

// Message text outside the app (SEC-64): email and push quote a message only when the recipient
// allows it per channel. Email defaults to no text, push to the text; the bell is unaffected, and
// a photo or location is still named by its kind (that is not message text).
describe("message text in email and push", () => {
  const delivered = async (
    t: TestConvex<typeof schema>,
    row: Doc<"notifications">,
    channel: "email" | "push" | undefined,
  ) => {
    const content = await t.query(
      internal.notifications.resolveForDelivery.resolveForDelivery,
      {
        recipientId: row.userId,
        type: row.type,
        params: row.params ?? {},
        ...(row.relatedId !== undefined ? { relatedId: row.relatedId } : {}),
        ...(row.actorIds?.[0] !== undefined
          ? { actorId: row.actorIds[0] }
          : {}),
        ...(row.subject !== undefined ? { subject: row.subject } : {}),
        ...(channel !== undefined ? { channel } : {}),
      },
    );
    if (!content) throw new Error("expected delivery content");
    return content;
  };

  const setPreview = (
    t: TestConvex<typeof schema>,
    channel: "email" | "push",
    enabled: boolean,
  ) =>
    as(t, "clerk_nora").mutation(
      api.notifications.setMessagePreview.setMessagePreview,
      { channel, enabled },
    );

  const TEXT = "Still have the Ravensburger?";

  test("defaults: the email leaves the text out, the push quotes it", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);

    expect(
      await as(t, "clerk_nora").query(
        api.notifications.getMyMessagePreviews.getMyMessagePreviews,
        {},
      ),
    ).toEqual({ email: false, push: true });

    const email = await delivered(t, row, "email");
    expect(email.params).not.toHaveProperty("messagePreview");
    expect(email.params.actorName).toBe("Pat Publicname");
    const rendered = await renderEmail({
      type: "message_received",
      params: email.params,
      locale: "en",
      baseUrl: "https://jigswap.test",
      relatedId: row.relatedId,
      href: email.href,
      actorAnonymous: email.actorAnonymous,
    });
    expect(rendered.text).not.toContain(TEXT);
    expect(rendered.html).not.toContain(TEXT);

    const push = await delivered(t, row, "push");
    expect(push.params.messagePreview).toBe(TEXT);
    expect(pushTextOf("message_received", push).message).toBe(TEXT);
  });

  test("a delivery that names no channel quotes nothing", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);
    expect((await delivered(t, row, undefined)).params).not.toHaveProperty(
      "messagePreview",
    );
  });

  test("each channel follows the member's own choice", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);

    await setPreview(t, "email", true);
    await setPreview(t, "push", false);
    expect(
      await as(t, "clerk_nora").query(
        api.notifications.getMyMessagePreviews.getMyMessagePreviews,
        {},
      ),
    ).toEqual({ email: true, push: false });

    expect((await delivered(t, row, "email")).params.messagePreview).toBe(TEXT);
    const push = await delivered(t, row, "push");
    expect(push.params).not.toHaveProperty("messagePreview");
    expect(pushTextOf("message_received", push)).toEqual({
      title: "New message",
      message: "Pat Publicname sent you a message",
    });
  });

  test("the setting leaves the per-type toggles and the bell alone", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const before = await as(t, "clerk_nora").query(
      api.notifications.getMyPreferences.getMyPreferences,
      {},
    );
    await setPreview(t, "push", false);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);

    expect(
      await as(t, "clerk_nora").query(
        api.notifications.getMyPreferences.getMyPreferences,
        {},
      ),
    ).toEqual(before);
    const { page } = await recipientPayloads(t, row);
    expect(page.page[0].context.messagePreview).toBe(TEXT);
  });

  test("a shared location is still named by its kind", async () => {
    const t = convexTest(schema, modules);
    const { pat, nora } = await seed(t);
    const row = await dmFrom(t, { id: pat, clerkId: "clerk_pat" }, nora);
    // The thread's newest message becomes a location.
    await t.run(async (ctx) => {
      const threadId = row.relatedId!;
      const attachmentId = await ctx.db.insert("messageAttachments", {
        kind: "location",
        threadAggregateId: threadId,
        uploaderId: pat,
        precision: "approximate",
        mapStatus: "failed",
        messageId: "loc-1",
        createdAt: Date.now() + 10,
        updatedAt: Date.now() + 10,
      });
      await ctx.db.insert("threadMessages", {
        threadAggregateId: threadId,
        messageId: "loc-1",
        authorId: pat,
        kind: "location",
        body: "",
        attachmentId,
        sentAt: Date.now() + 10,
      });
    });
    for (const channel of ["email", "push"] as const) {
      const content = await delivered(t, row, channel);
      expect(content.params.messageKind).toBe("location");
      expect(content.params).not.toHaveProperty("messagePreview");
    }
  });

  test("only a member can read or change the setting", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.notifications.getMyMessagePreviews.getMyMessagePreviews, {}),
    ).rejects.toThrow("Unauthenticated");
    await expect(
      t.mutation(api.notifications.setMessagePreview.setMessagePreview, {
        channel: "email",
        enabled: true,
      }),
    ).rejects.toThrow("Unauthenticated");
  });
});
