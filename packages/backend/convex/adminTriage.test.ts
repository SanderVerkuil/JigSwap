import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { MAX_DOC_FEEDBACK_PAGE } from "./docs/listDocFeedback";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seed = async (t: TestConvex<typeof schema>) =>
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

const asMember = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: TestConvex<typeof schema>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const firstPage = { paginationOpts: { numItems: 10, cursor: null } };

describe("contact/listContactMessages", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.contact.listContactMessages.listContactMessages, firstPage),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(
        api.contact.listContactMessages.listContactMessages,
        firstPage,
      ),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      asMember(t).query(api.contact.listContactMessages.listContactMessages, {
        ...firstPage,
        status: "new",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("without a status returns every message, newest first, for an admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      firstPage,
    );
    expect(result.isDone).toBe(true);
    expect(result.page.map((r) => r.name)).toEqual(["Tom", "Mara"]);
    expect(result.page.map((r) => r.status)).toEqual(["handled", "new"]);
  });

  test("a status narrows the inbox to new or handled messages", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const fresh = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      { ...firstPage, status: "new" },
    );
    expect(fresh.page.map((r) => r.name)).toEqual(["Mara"]);
    const handled = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      { ...firstPage, status: "handled" },
    );
    expect(handled.page.map((r) => r.name)).toEqual(["Tom"]);
  });

  test("holds at most 50 messages per page, whatever the client asks for", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert("contactMessages", {
          name: `Sender ${i}`,
          email: "x@example.com",
          subject: "other",
          message: "Another message for the inbox.",
          status: "new",
          createdAt: Date.now() + i,
        });
      }
    });
    const huge = { numItems: 1e6, cursor: null };
    const all = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      { paginationOpts: huge },
    );
    expect(all.page).toHaveLength(50);
    expect(all.isDone).toBe(false);
    const filtered = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      { paginationOpts: huge, status: "new" },
    );
    expect(filtered.page).toHaveLength(50);
    expect(filtered.isDone).toBe(false);
  });

  test("pages newest first within a status", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    // Two more new messages: newest is Zoë, then Yara, then the seeded Mara.
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [name, at] of [
        ["Yara", now + 1000],
        ["Zoë", now + 2000],
      ] as const) {
        await ctx.db.insert("contactMessages", {
          name,
          email: "x@example.com",
          subject: "other",
          message: "Another message for the inbox.",
          status: "new",
          createdAt: at,
        });
      }
    });
    const page1 = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      { paginationOpts: { numItems: 2, cursor: null }, status: "new" },
    );
    expect(page1.page.map((r) => r.name)).toEqual(["Zoë", "Yara"]);
    expect(page1.isDone).toBe(false);
    const page2 = await asAdmin(t).query(
      api.contact.listContactMessages.listContactMessages,
      {
        paginationOpts: { numItems: 2, cursor: page1.continueCursor },
        status: "new",
      },
    );
    expect(page2.page.map((r) => r.name)).toEqual(["Mara"]);
    expect(page2.isDone).toBe(true);
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

describe("contact/reopenContactMessage", () => {
  test("rejects an unauthenticated caller and a non-admin member", async () => {
    const t = convexTest(schema, modules);
    const { newer } = await seed(t);
    await expect(
      t.mutation(api.contact.reopenContactMessage.reopenContactMessage, {
        id: newer,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    await expect(
      asMember(t).mutation(
        api.contact.reopenContactMessage.reopenContactMessage,
        { id: newer },
      ),
    ).rejects.toThrow(/Forbidden/);
    const row = await t.run((ctx) => ctx.db.get(newer));
    expect(row?.status).toBe("handled");
  });

  test("puts a handled message back to new for an admin (the Undo of mark as handled)", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await asAdmin(t).mutation(
      api.contact.markContactMessageHandled.markContactMessageHandled,
      { id: older },
    );
    await asAdmin(t).mutation(
      api.contact.reopenContactMessage.reopenContactMessage,
      { id: older },
    );
    const row = await t.run((ctx) => ctx.db.get(older));
    expect(row?.status).toBe("new");
  });

  test("refuses a message that no longer exists", async () => {
    const t = convexTest(schema, modules);
    const { older } = await seed(t);
    await t.run((ctx) => ctx.db.delete(older));
    await expect(
      asAdmin(t).mutation(
        api.contact.reopenContactMessage.reopenContactMessage,
        { id: older },
      ),
    ).rejects.toThrow(/message_not_found/);
  });
});

describe("docs/listDocFeedback", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.docs.listDocFeedback.listDocFeedback, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a non-admin member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      asMember(t).query(api.docs.listDocFeedback.listDocFeedback, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("returns the feedback entries for an admin", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const { page, isDone } = await asAdmin(t).query(
      api.docs.listDocFeedback.listDocFeedback,
      { paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(isDone).toBe(true);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      slug: "getting-started",
      helpful: true,
      comment: "Very clear, thanks!",
    });
  });

  // An anonymous form feeds this table, up to 300 votes a day at 2,000 characters each: in about a
  // month the whole table no longer fits one read.
  test("pages newest first, whatever the table holds and the client asks for", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 500 },
    });
    await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 600; i++) {
        await ctx.db.insert("docFeedback", {
          slug: `page-${i}`,
          helpful: false,
          comment: "x".repeat(2000),
          createdAt: i,
        });
      }
    });
    const read = (paginationOpts: {
      numItems: number;
      cursor: string | null;
    }) =>
      asAdmin(t).query(api.docs.listDocFeedback.listDocFeedback, {
        paginationOpts,
      });

    const first = await read({ numItems: 1e9, cursor: null });
    expect(first.page).toHaveLength(MAX_DOC_FEEDBACK_PAGE);
    expect(first.page[0]?.slug).toBe("page-599");
    expect(first.isDone).toBe(false);

    const next = await read({ numItems: 10, cursor: first.continueCursor });
    expect(next.page).toHaveLength(10);
    expect(next.page[0]?.slug).toBe(`page-${599 - MAX_DOC_FEEDBACK_PAGE}`);
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

  // Only the versioned template's `metadata` claim (Clerk public_metadata) counts. A flat `role`
  // claim could come from a template that maps something else, so it never grants admin.
  test("false for a flat role claim outside metadata", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const asFlatRole = t.withIdentity({
      subject: "clerk_alice",
      role: "admin",
    });
    expect(
      await asFlatRole.query(
        api.identity.isCurrentUserAdmin.isCurrentUserAdmin,
        {},
      ),
    ).toBe(false);
    await expect(
      asFlatRole.query(
        api.contact.listContactMessages.listContactMessages,
        firstPage,
      ),
    ).rejects.toThrow(/Forbidden/);
  });
});
