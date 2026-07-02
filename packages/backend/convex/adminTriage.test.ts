import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const older = await ctx.db.insert("contactMessages", {
      name: "Mara",
      email: "mara@example.com",
      subject: "swap",
      message: "I'd love to swap my 1000-piece forest puzzle.",
      status: "new",
      createdAt: now - 1000,
    });
    const newer = await ctx.db.insert("contactMessages", {
      name: "Tom",
      email: "tom@example.com",
      subject: "account",
      message: "I cannot change my profile picture, please help.",
      status: "handled",
      createdAt: now,
    });
    await ctx.db.insert("docFeedback", {
      slug: "getting-started",
      helpful: true,
      comment: "Very clear, thanks!",
      locale: "en",
      createdAt: now,
    });
    return { older, newer };
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

describe("contact/listContactMessages", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.contact.listContactMessages.listContactMessages, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(
        api.contact.listContactMessages.listContactMessages,
        {},
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns every message, newest first, for an admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const rows = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      {},
    );
    expect(rows.map((r) => r.name)).toEqual(["Tom", "Mara"]);
    expect(rows.map((r) => r.status)).toEqual(["handled", "new"]);
  });
});

describe("contact/markContactMessageHandled", () => {
  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await expect(
      asMember(t).mutation(
        api.contact.markContactMessageHandled.markContactMessageHandled,
        { id: older },
      ),
    ).rejects.toThrow(/Forbidden/);
  });

  test("marks a new message handled for an admin", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await asAdmin(t).mutation(
      api.contact.markContactMessageHandled.markContactMessageHandled,
      { id: older },
    );
    const row = await t.run((ctx) => ctx.db.get(older));
    expect(row?.status).toBe("handled");
  });
});

describe("docs/listDocFeedback", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.docs.listDocFeedback.listDocFeedback, {}),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(api.docs.listDocFeedback.listDocFeedback, {}),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns the feedback entries for an admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const rows = await asAdmin(t).query(
      api.docs.listDocFeedback.listDocFeedback,
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "getting-started",
      helpful: true,
      comment: "Very clear, thanks!",
    });
  });
});

describe("identity/isCurrentUserAdmin", () => {
  test("false for an unauthenticated caller (fails closed)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await t.query(api.identity.isCurrentUserAdmin.isCurrentUserAdmin, {}),
    ).toBe(false);
  });

  test("false for a member without the admin role", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await asMember(t).query(
        api.identity.isCurrentUserAdmin.isCurrentUserAdmin,
        {},
      ),
    ).toBe(false);
  });

  test("true for an admin (metadata.role claim)", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await asAdmin(t).query(
        api.identity.isCurrentUserAdmin.isCurrentUserAdmin,
        {},
      ),
    ).toBe(true);
  });
});
