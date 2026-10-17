import { Notification } from "@jigswap/domain";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import { emailChannel } from "./notifications/adapters/channels/emailChannel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type ClerkEmail = { id: string; email_address: string; verified: boolean };

// Minimal Clerk UserJSON stand-in (same shape as userNameSync.test.ts), with real Clerk
// EmailAddressJSON entries: the primary is chosen by `primary_email_address_id`, not array order.
const clerkUser = (
  emails: ClerkEmail[],
  primary_email_address_id: string | null,
) => ({
  id: "clerk_mail",
  first_name: "Mara",
  last_name: null,
  username: "mara",
  primary_email_address_id,
  email_addresses: emails.map((e) => ({
    id: e.id,
    object: "email_address",
    email_address: e.email_address,
    verification: {
      status: e.verified ? ("verified" as const) : ("unverified" as const),
    },
  })),
  image_url: "https://img.clerk.com/mara.png",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  public_metadata: {},
});

const sync = (
  t: TestConvex<typeof schema>,
  user: ReturnType<typeof clerkUser>,
) => t.mutation(internal.users.updateOrCreateUser, { clerkUser: user });

const findRow = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_mail"))
      .unique(),
  );

const old = { id: "idn_old", email_address: "old@example.com", verified: true };
const work = {
  id: "idn_work",
  email_address: "work@example.com",
  verified: true,
};

describe("users/updateOrCreateUser email sync", () => {
  test("the verified primary is used even when it is not the first address", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([old, work], "idn_work"));
    expect((await findRow(t))?.email).toBe("work@example.com");
  });

  test("an unverified primary is not stored for a new member", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([{ ...work, verified: false }, old], "idn_work"));
    const row = await findRow(t);
    expect(row).not.toBeNull();
    expect(row?.email).toBeUndefined();
  });

  test("an unverified primary does not replace the stored verified email", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([old], "idn_old"));
    await sync(t, clerkUser([{ ...work, verified: false }, old], "idn_work"));
    expect((await findRow(t))?.email).toBe("old@example.com");
  });

  test("a changed verified primary updates the stored email", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([old, work], "idn_old"));
    expect((await findRow(t))?.email).toBe("old@example.com");
    await sync(t, clerkUser([old, work], "idn_work"));
    expect((await findRow(t))?.email).toBe("work@example.com");
  });

  test("a user with no email addresses syncs without crashing", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([], null));
    const row = await findRow(t);
    expect(row?.name).toBe("Mara");
    expect(row?.email).toBeUndefined();
  });
});

describe("email channel without a member email", () => {
  test("schedules no email send for a member with no email", async () => {
    const t = convexTest(schema, modules);
    await sync(t, clerkUser([], null));
    const row = await findRow(t);
    await t.run(async (ctx) => {
      await emailChannel(ctx)(
        Notification.rehydrate({
          id: "notif_1",
          userId: row!._id,
          type: "trade_request",
          channel: "email",
          isRead: false,
          createdAt: new Date(),
        } as unknown as Parameters<typeof Notification.rehydrate>[0]),
      );
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.filter((s) => s.name.includes("sendEmail"))).toHaveLength(
      0,
    );
  });
});
