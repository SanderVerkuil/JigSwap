import presenceTest from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

// Bundle every Convex module for the in-memory test runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// A POST to the webhook signed with `secret` the way Svix signs Clerk's deliveries.
const signedPost = (secret: string, body: string): RequestInit => {
  const msgId = "msg_test";
  const timestamp = new Date();
  return {
    method: "POST",
    headers: {
      "svix-id": msgId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(msgId, timestamp, body),
    },
    body,
  };
};

describe("clerk users webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("responds 503 when CLERK_WEBHOOK_SECRET is unset (env-less preview deployment)", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", undefined);
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(503);
  });

  test("responds 400 when the secret is set but the signature is invalid", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "whsec_dGVzdHNlY3JldA==");
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(400);
  });

  test("accepts a correctly signed event and parses its payload", async () => {
    const secret = "whsec_dGVzdHNlY3JldA==";
    vi.stubEnv("CLERK_WEBHOOK_SECRET", secret);
    const t = convexTest(schema, modules);
    const body = JSON.stringify({ type: "session.created", data: {} });
    const response = await t.fetch(
      "/clerk-users-webhook",
      signedPost(secret, body),
    );
    expect(response.status).toBe(200);
  });

  // The only path from Clerk's delete event to the account erasure: a misrouted user.deleted
  // would fall to the default branch, still answer 200 and never be retried.
  test("erases the member on a signed user.deleted", async () => {
    const secret = "whsec_dGVzdHNlY3JldA==";
    vi.stubEnv("CLERK_WEBHOOK_SECRET", secret);
    const t = convexTest(schema, modules);
    // deleteUser schedules the member purge, whose presence phase needs the component.
    presenceTest.register(t);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_alice",
        name: "Alice",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const body = JSON.stringify({
      type: "user.deleted",
      data: { id: "clerk_alice", deleted: true, object: "user" },
    });

    const response = await t.fetch(
      "/clerk-users-webhook",
      signedPost(secret, body),
    );

    expect(response.status).toBe(200);
    const { users, deleted } = await t.run(async (ctx) => ({
      users: await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_alice"))
        .collect(),
      deleted: await ctx.db.query("deletedClerkUsers").collect(),
    }));
    expect(users).toEqual([]);
    expect(deleted).toHaveLength(1);
  });
});
