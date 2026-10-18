import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Message views must never carry a hidden member's raw user id: a PRIVATE member (anonymous to a
// non-mutual) who replies in a thread stays anonymous in every payload the other party receives.
// Views carry a viewer-relative `isMine` instead of an author id.

// Read receipts and sentAt are Date.now() millis; keep time-ordered actions strictly increasing.
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

// Priya: private profile, distinctive name/username. Nora: shares a circle with Priya (so the
// ConnectionPolicy lets her open a DM) but neither follows the other.
const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const priya = await ctx.db.insert("users", {
      clerkId: "clerk_priya",
      email: "priya@example.com",
      name: "Priya Hiddenname",
      username: "priyahidden",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const nora = await ctx.db.insert("users", {
      clerkId: "clerk_nora",
      email: "nora@example.com",
      name: "Nora",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: priya,
      visibility: "private",
      updatedAt: now,
    });
    await ctx.db.insert("circleMembers", {
      circleAggregateId: "circle-1",
      memberId: priya,
    });
    await ctx.db.insert("circleMembers", {
      circleAggregateId: "circle-1",
      memberId: nora,
    });
    return { priya, nora };
  });

const asPriya = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_priya" });
const asNora = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_nora" });

describe("thread message author privacy", () => {
  test("a private member's reply never exposes their id to a non-mutual", async () => {
    const t = convexTest(schema, modules);
    const { priya, nora } = await seed(t);

    const threadId = await asNora(t).mutation(
      api.conversation.openDmThread.openDmThread,
      { recipientId: priya },
    );
    await tick();
    await asNora(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "hi there",
    });
    await tick();
    await asPriya(t).mutation(api.conversation.postMessage.postMessage, {
      threadId,
      kind: "text",
      body: "hello back",
    });

    const messages = await asNora(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    const inbox = await asNora(t).query(
      api.conversation.getMyInbox.getMyInbox,
      {},
    );
    const unread = await asNora(t).query(
      api.conversation.getUnreadTotal.getUnreadTotal,
      {},
    );

    // Precondition: Priya is anonymous to Nora through the privacy chokepoint.
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject.otherMember.anonymous).toBe(true);

    for (const payload of [messages, inbox, unread]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(priya as string);
      expect(json).not.toContain("Hiddenname");
      expect(json).not.toContain("priyahidden");
    }

    // Viewer-relative authorship instead of raw ids.
    expect(messages.map((m) => [m.body, m.isMine])).toEqual([
      ["hi there", true],
      ["hello back", false],
    ]);
    for (const m of messages) expect(m).not.toHaveProperty("authorId");
    expect(inbox[0].lastMessage?.body).toBe("hello back");
    expect(inbox[0].lastMessage?.isMine).toBe(false);
    expect(inbox[0].lastMessage).not.toHaveProperty("authorId");

    // The same messages, seen by Priya, flip `isMine`; Nora's id is not needed either.
    const priyaMessages = await asPriya(t).query(
      api.conversation.getThreadMessages.getThreadMessages,
      { threadId },
    );
    expect(priyaMessages.map((m) => m.isMine)).toEqual([false, true]);
    expect(JSON.stringify(priyaMessages)).not.toContain(nora as string);
  });
});
