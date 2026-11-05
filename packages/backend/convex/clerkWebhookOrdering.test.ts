import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Svix delivers Clerk user events at least once and in no guaranteed order, and retries for hours.
// users.updateOrCreateUser must therefore never bring a deleted member back, never refill a
// CSAM-tombstoned row, and never let an older event overwrite newer data (SEC-32).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

// deleteUser schedules the member purge, whose presence phase needs the component.
const newT = (): T => {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  return t;
};

const CLERK_ID = "user_2mara";
const T0 = 1_700_000_000_000;

// Minimal Clerk UserJSON stand-in (same shape as userNameSync.test.ts).
const clerkUser = (
  updatedAt: number,
  { firstName = "Mara", email = "mara@example.com" } = {},
) => ({
  id: CLERK_ID,
  first_name: firstName,
  last_name: "Jansen",
  username: "mara",
  primary_email_address_id: "idn_mara",
  email_addresses: [
    {
      id: "idn_mara",
      email_address: email,
      verification: { status: "verified" as const },
    },
  ],
  image_url: "https://img.clerk.com/mara.png",
  created_at: T0,
  updated_at: updatedAt,
  public_metadata: {},
});

const sync = (t: T, user: ReturnType<typeof clerkUser>) =>
  t.mutation(internal.users.updateOrCreateUser, { clerkUser: user });

const deleteMara = (t: T) =>
  t.mutation(internal.users.deleteUser, { id: CLERK_ID });

const usersRows = (t: T) => t.run((ctx) => ctx.db.query("users").collect());

const findMara = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", CLERK_ID))
      .unique(),
  );

// The fields a sync writes, without system fields, for before/after comparisons.
const syncedShape = async (t: T) => {
  const row = await findMara(t);
  if (row === null) return null;
  const { _id, _creationTime, ...fields } = row;
  return fields;
};

describe("users/deleteUser tombstone", () => {
  test("a late user.updated after user.deleted does not recreate the member", async () => {
    const t = newT();
    await sync(t, clerkUser(T0));
    await deleteMara(t);

    await sync(t, clerkUser(T0 + 1_000));

    expect(await usersRows(t)).toEqual([]);
  });

  test("a user.created delivered after user.deleted does not create the member", async () => {
    const t = newT();
    // The delete arrives first (the created event is still being retried): nothing to delete yet.
    await deleteMara(t);

    await sync(t, clerkUser(T0));

    expect(await usersRows(t)).toEqual([]);
  });

  test("the tombstone keeps a fingerprint, never the Clerk id itself", async () => {
    const t = newT();
    await sync(t, clerkUser(T0));
    await deleteMara(t);
    // A redelivered user.deleted adds nothing.
    await deleteMara(t);

    const tombstones = await t.run((ctx) =>
      ctx.db.query("deletedClerkUsers").collect(),
    );
    expect(tombstones).toHaveLength(1);
    expect(JSON.stringify(tombstones)).not.toContain(CLERK_ID);
    expect(tombstones[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("another Clerk account is unaffected by a tombstone", async () => {
    const t = newT();
    await deleteMara(t);

    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: { ...clerkUser(T0), id: "user_2other" },
    });

    const rows = await usersRows(t);
    expect(rows.map((row) => row.clerkId)).toEqual(["user_2other"]);
  });
});

describe("users/updateOrCreateUser on a CSAM-tombstoned row", () => {
  test("a late user.updated leaves the tombstoned row inactive and blank", async () => {
    const t = newT();
    await sync(t, clerkUser(T0));
    const mara = (await findMara(t))!._id;
    await t.run((ctx) =>
      ctx.db.insert("csamEscalations", {
        table: "ownedPuzzleImages",
        rowId: "row_1",
        uploaderId: mara,
        md5: "md5",
        sha1: "sha1",
        provider: "test",
        matchedAt: T0,
        status: "open",
      }),
    );
    await deleteMara(t);

    await sync(t, clerkUser(T0 + 1_000, { firstName: "Mara2" }));

    const row = await findMara(t);
    expect(row?.isActive).toBe(false);
    expect(row?.name).toBeUndefined();
    expect(row?.email).toBeUndefined();
    expect(row?.username).toBeUndefined();
    expect(row?.avatar).toBeUndefined();
    expect(row?.searchableName).toBeUndefined();
  });

  test("an inactive row is never patched, even without a tombstone", async () => {
    const t = newT();
    // A row deactivated before tombstones existed.
    await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: CLERK_ID,
        isActive: false,
        createdAt: T0,
        updatedAt: T0,
      }),
    );

    await sync(t, clerkUser(T0 + 1_000));

    const row = await findMara(t);
    expect(row?.isActive).toBe(false);
    expect(row?.name).toBeUndefined();
    expect(row?.email).toBeUndefined();
  });
});

describe("users/updateOrCreateUser event order", () => {
  test("an older event after a newer one changes nothing", async () => {
    const t = newT();
    await sync(t, clerkUser(T0));
    await sync(
      t,
      clerkUser(T0 + 2_000, { firstName: "Marie", email: "new@example.com" }),
    );
    const newest = await syncedShape(t);

    await sync(
      t,
      clerkUser(T0 + 1_000, { firstName: "Mara", email: "old@example.com" }),
    );

    expect(await syncedShape(t)).toEqual(newest);
    expect(newest?.name).toBe("Marie Jansen");
    expect(newest?.email).toBe("new@example.com");
  });

  test("user.updated before user.created converges to the newest data", async () => {
    const t = newT();
    // The update overtakes the create (the create was retried).
    await sync(t, clerkUser(T0 + 1_000, { firstName: "Marie" }));
    await sync(t, clerkUser(T0, { firstName: "Mara" }));

    const rows = await usersRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Marie Jansen");
    expect(rows[0].isActive).toBe(true);
  });

  test("replaying the same event is idempotent", async () => {
    const t = newT();
    await sync(t, clerkUser(T0 + 1_000, { firstName: "Marie" }));
    const once = await syncedShape(t);

    await sync(t, clerkUser(T0 + 1_000, { firstName: "Marie" }));

    expect(await usersRows(t)).toHaveLength(1);
    expect(await syncedShape(t)).toEqual(once);
  });

  test("a row synced before ordering was tracked accepts the next event", async () => {
    const t = newT();
    // Legacy row: no clerkUpdatedAt yet, and a later updatedAt from a profile edit.
    await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: CLERK_ID,
        name: "Old Name",
        isActive: true,
        createdAt: T0,
        updatedAt: T0 + 50_000,
      }),
    );

    await sync(t, clerkUser(T0 + 1_000, { firstName: "Marie" }));

    expect((await findMara(t))?.name).toBe("Marie Jansen");
  });
});
