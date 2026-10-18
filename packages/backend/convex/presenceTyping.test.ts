import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// The appear-offline seam of typing (G7 x G8, spec Q13), unmocked: a member whose presence
// override is "invisible" emits no typing, and switching to it ends a live typing signal.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

const seed = async () => {
  const t = convexTest(schema, modules);
  const alice = await mkUser(t, "alice");
  const bob = await mkUser(t, "bob");
  await t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId: alice,
      followeeId: bob,
      createdAt: 1,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: 1,
    });
  });
  const threadId = (await t
    .withIdentity({ subject: "alice" })
    .mutation(api.conversation.openDmThread.openDmThread, {
      recipientId: bob,
    })) as string;
  return { t, threadId };
};

const setOverride = (t: T, who: string, override: "auto" | "invisible") =>
  t
    .withIdentity({ subject: who })
    .mutation(api.social.setPresencePreferences.setPresencePreferences, {
      override,
    });
const setTyping = (t: T, who: string, threadId: string) =>
  t
    .withIdentity({ subject: who })
    .mutation(api.conversation.setTyping.setTyping, { threadId });
const getTyping = (t: T, who: string, threadId: string) =>
  t
    .withIdentity({ subject: who })
    .query(api.conversation.getTyping.getTyping, { threadId });

test("a member appearing offline emits no typing", async () => {
  const { t, threadId } = await seed();
  await setOverride(t, "alice", "invisible");
  await setTyping(t, "alice", threadId);
  expect(await getTyping(t, "bob", threadId)).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("typingIndicators").collect()),
  ).toEqual([]);
});

test("switching to appear offline ends a live typing signal", async () => {
  const { t, threadId } = await seed();
  await setTyping(t, "alice", threadId);
  expect(await getTyping(t, "bob", threadId)).toHaveLength(1);
  await setOverride(t, "alice", "invisible");
  expect(await getTyping(t, "bob", threadId)).toEqual([]);
});

test("an automatic member still types", async () => {
  const { t, threadId } = await seed();
  await setOverride(t, "alice", "auto");
  await setTyping(t, "alice", threadId);
  expect(await getTyping(t, "bob", threadId)).toHaveLength(1);
});
