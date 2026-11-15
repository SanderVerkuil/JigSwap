import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const flushScheduled = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
};

// Reading a thread in /messages clears its grouped bell row, and the bell never previews the
// member's own newest reply under the other member's name.
test("markThreadRead marks the thread's bell row read; own reply is not previewed", async () => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  const { bob } = await t.run(async (ctx) => {
    const now = Date.now();
    const mk = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const mara = await mk("clerk_mara", "Mara");
    const bob = await mk("clerk_bob", "Bob");
    for (const [a, b] of [
      [mara, bob],
      [bob, mara],
    ] as const) {
      await ctx.db.insert("follows", {
        followerId: a,
        followeeId: b,
        createdAt: 1,
      });
    }
    return { bob };
  });
  const asMara = t.withIdentity({ subject: "clerk_mara" });
  const asBob = t.withIdentity({ subject: "clerk_bob" });

  const threadId = await asMara.mutation(
    api.conversation.openDmThread.openDmThread,
    { recipientId: bob },
  );
  await asMara.mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "Are you free Saturday?",
  });
  await flushScheduled(t);
  expect(await asBob.query(api.notifications.unreadCount.unreadCount, {})).toBe(
    1,
  );

  await asBob.mutation(api.conversation.markThreadRead.markThreadRead, {
    threadId,
  });
  await asBob.mutation(api.conversation.postMessage.postMessage, {
    threadId,
    kind: "text",
    body: "MY OWN REPLY",
  });
  await flushScheduled(t);

  expect(await asBob.query(api.notifications.unreadCount.unreadCount, {})).toBe(
    0,
  );
  const page = await asBob.query(
    api.notifications.listMyNotificationViews.listMyNotificationViews,
    { paginationOpts: { numItems: 20, cursor: null } },
  );
  const view = page.page.find((v) => v.type === "message_received");
  expect(view?.isRead).toBe(true);
  expect(JSON.stringify(view?.context)).not.toContain("MY OWN REPLY");
});
