import { ClerkAPIResponseError } from "@clerk/backend/errors";
import presenceTest from "@convex-dev/presence/test";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// backfillUserRoles pages the Clerk Backend API; no test reaches Clerk.
const clerk = vi.hoisted(() => ({
  createClerkClient: vi.fn(),
  getUserList: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: clerk.createClerkClient,
}));

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Minimal Clerk UserJSON stand-in: updateOrCreateUser reads exactly these fields
// (its args are v.any() — the webhook trusts Clerk).
const clerkUser = (publicMetadata: Record<string, unknown>) => ({
  id: "clerk_mara",
  first_name: "Mara",
  last_name: "Jansen",
  username: "mara",
  primary_email_address_id: "idn_mara",
  email_addresses: [
    {
      id: "idn_mara",
      email_address: "mara@example.com",
      verification: { status: "verified" as const },
    },
  ],
  image_url: "https://img.clerk.com/mara.png",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  public_metadata: publicMetadata,
});

const findMara = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_mara"))
      .unique(),
  );

describe("users/updateOrCreateUser role mirror", () => {
  test("insert mirrors publicMetadata.role onto the users row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: "admin" }),
    });
    const row = await findMara(t);
    expect(row?.role).toBe("admin");
  });

  test("insert without a role leaves the field unset", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({}),
    });
    const row = await findMara(t);
    expect(row?.role).toBeUndefined();
  });

  test("update mirrors a granted role", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({}),
    });
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: "admin" }),
    });
    const row = await findMara(t);
    expect(row?.role).toBe("admin");
  });

  test("update clears the mirror when the role is revoked in Clerk", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: "admin" }),
    });
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({}),
    });
    const row = await findMara(t);
    expect(row?.role).toBeUndefined();
  });

  test("a non-string role claim is ignored", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: 42 }),
    });
    const row = await findMara(t);
    expect(row?.role).toBeUndefined();
  });
});

describe("users/patchUserRole (backfill write)", () => {
  test("patches the mirrored role onto the row matching the clerkId", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({}),
    });
    await t.mutation(internal.users.patchUserRole, {
      clerkId: "clerk_mara",
      role: "admin",
    });
    const row = await findMara(t);
    expect(row?.role).toBe("admin");
  });

  test("clears the mirror when called without a role", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: "admin" }),
    });
    await t.mutation(internal.users.patchUserRole, { clerkId: "clerk_mara" });
    const row = await findMara(t);
    expect(row?.role).toBeUndefined();
  });

  test("is a no-op for an unknown clerkId", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.users.patchUserRole, {
        clerkId: "clerk_ghost",
        role: "admin",
      }),
    ).resolves.toBe(false);
  });

  // The daily reconcile calls this for every Clerk user: an unchanged role writes nothing.
  test("writes nothing when the role is unchanged", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser({ role: "admin" }),
    });
    await expect(
      t.mutation(internal.users.patchUserRole, {
        clerkId: "clerk_mara",
        role: "admin",
      }),
    ).resolves.toBe(false);
    await expect(
      t.mutation(internal.users.patchUserRole, { clerkId: "clerk_mara" }),
    ).resolves.toBe(true);
    expect((await findMara(t))?.role).toBeUndefined();
  });

  test("leaves a deactivated row alone", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId: "clerk_mara",
        isActive: false,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      }),
    );
    await expect(
      t.mutation(internal.users.patchUserRole, {
        clerkId: "clerk_mara",
        role: "admin",
      }),
    ).resolves.toBe(false);
    expect((await findMara(t))?.role).toBeUndefined();
  });
});

describe("backfillUserRoles/run (daily role reconcile)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clerk.createClerkClient.mockReturnValue({
      users: { getUserList: clerk.getUserList, getUser: clerk.getUser },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const seedMember = (
    t: TestConvex<typeof schema>,
    clerkId: string,
    fields: { role?: string; isActive?: boolean } = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("users", {
        clerkId,
        isActive: fields.isActive ?? true,
        role: fields.role,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      }),
    );

  test("mirrors every Clerk role onto the users rows", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_reconcile");
    const t = convexTest(schema, modules);
    const revoked = await seedMember(t, "clerk_revoked", { role: "admin" });
    const granted = await seedMember(t, "clerk_granted");
    const kept = await seedMember(t, "clerk_kept", { role: "admin" });
    const inactive = await seedMember(t, "clerk_inactive", { isActive: false });
    clerk.getUserList.mockResolvedValue({
      data: [
        { id: "clerk_revoked", publicMetadata: {} },
        { id: "clerk_granted", publicMetadata: { role: "admin" } },
        { id: "clerk_kept", publicMetadata: { role: "admin" } },
        { id: "clerk_inactive", publicMetadata: { role: "admin" } },
      ],
      totalCount: 4,
    });

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toEqual({ scanned: 4, patched: 2, deleted: 0 });
    expect(clerk.getUser).not.toHaveBeenCalled();
    const roles = await t.run(async (ctx) =>
      Promise.all(
        [revoked, granted, kept, inactive].map(
          async (id) => (await ctx.db.get(id))?.role ?? null,
        ),
      ),
    );
    expect(roles).toEqual([null, "admin", "admin", null]);
  });

  const clerkError = (status: number) =>
    new ClerkAPIResponseError("Clerk refused", {
      data: [
        { code: "resource_not_found", message: "nope", long_message: "nope" },
      ],
      status,
    });
  const rolesOf = (t: TestConvex<typeof schema>, ids: Id<"users">[]) =>
    t.run(async (ctx) =>
      Promise.all(ids.map(async (id) => (await ctx.db.get(id))?.role ?? null)),
    );

  test("spends no mutation on a member with no role on either side", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const clerkId of ["clerk_plain_1", "clerk_plain_2", "clerk_admin"]) {
        await ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.com`,
          name: clerkId,
          isActive: true,
          ...(clerkId === "clerk_admin" ? { role: "admin" } : {}),
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
    clerk.getUserList.mockResolvedValueOnce({
      data: [
        { id: "clerk_plain_1", publicMetadata: {} },
        { id: "clerk_plain_2", publicMetadata: {} },
        { id: "clerk_plain_without_row", publicMetadata: {} },
        { id: "clerk_admin", publicMetadata: {} },
        {
          id: "clerk_new_admin_without_row",
          publicMetadata: { role: "admin" },
        },
      ],
      totalCount: 5,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toMatchObject({ scanned: 5, patched: 1 });
    // patchUserRole warns about a clerkId with no row: a role Clerk names still gets there, and
    // members with no role on either side (one with no row here too) never do.
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      "clerk_new_admin_without_row",
    ]);
  });

  // A user.deleted webhook lost for good (SEC-32) leaves an active row Clerk no longer lists, with
  // or without a role: Clerk's 404 for it runs the erasure the webhook would have.
  test("erases every member Clerk no longer has", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_reconcile");
    const t = convexTest(schema, modules);
    // deleteUser schedules the member purge, whose presence phase needs the component.
    presenceTest.register(t);
    await seedMember(t, "clerk_gone", { role: "admin" });
    const kept = await seedMember(t, "clerk_kept", { role: "admin" });
    await seedMember(t, "clerk_plain");
    clerk.getUserList.mockResolvedValue({
      data: [{ id: "clerk_kept", publicMetadata: { role: "admin" } }],
      totalCount: 1,
    });
    clerk.getUser.mockRejectedValue(clerkError(404));

    // Pages of one: the users rows Clerk did not list are found past the first page too.
    const result = await t.action(internal.backfillUserRoles.run, {
      pageSize: 1,
    });

    expect(result).toEqual({ scanned: 1, patched: 0, deleted: 2 });
    expect(clerk.getUser.mock.calls).toEqual([["clerk_gone"], ["clerk_plain"]]);
    const { users, tombstones } = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      tombstones: await ctx.db.query("deletedClerkUsers").collect(),
    }));
    expect(users.map((row) => row._id)).toEqual([kept]);
    expect(tombstones).toHaveLength(2);
  });

  // A CLERK_SECRET_KEY for another Clerk instance lists none of our members, and that instance
  // answers 404 for every one of them: that must never erase the membership.
  test("checks and erases nobody when more than five members look gone", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_other_instance");
    const t = convexTest(schema, modules);
    const ids: Id<"users">[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(await seedMember(t, `clerk_member_${i}`, { role: "admin" }));
    }
    clerk.getUserList.mockResolvedValue({ data: [], totalCount: 0 });
    clerk.getUser.mockRejectedValue(clerkError(404));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toEqual({ scanned: 0, patched: 0, deleted: 0 });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(clerk.getUser).not.toHaveBeenCalled();
    expect(await rolesOf(t, ids)).toEqual(Array(6).fill("admin"));
  });

  // Offset paging can skip a user when Clerk's list shifts mid-scan: a role-holder missing from
  // the pages is asked for directly, and only a 404 counts as gone.
  test("asks Clerk directly about a role-holder the paging missed", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_reconcile");
    const t = convexTest(schema, modules);
    const skipped = await seedMember(t, "clerk_skipped", { role: "admin" });
    const revoked = await seedMember(t, "clerk_revoked", { role: "admin" });
    const flaky = await seedMember(t, "clerk_flaky", { role: "admin" });
    clerk.getUserList.mockResolvedValue({ data: [], totalCount: 0 });
    clerk.getUser.mockImplementation(async (id: string) => {
      if (id === "clerk_skipped") {
        return { id, publicMetadata: { role: "admin" } };
      }
      if (id === "clerk_revoked") return { id, publicMetadata: {} };
      throw clerkError(503);
    });

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toEqual({ scanned: 0, patched: 1, deleted: 0 });
    expect(await rolesOf(t, [skipped, revoked, flaky])).toEqual([
      "admin",
      null,
      "admin",
    ]);
  });

  test("never looks up a deactivated row", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_reconcile");
    const t = convexTest(schema, modules);
    const inactive = await seedMember(t, "clerk_inactive", {
      role: "admin",
      isActive: false,
    });
    clerk.getUserList.mockResolvedValue({ data: [], totalCount: 0 });

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toEqual({ scanned: 0, patched: 0, deleted: 0 });
    expect(clerk.getUser).not.toHaveBeenCalled();
    expect(await rolesOf(t, [inactive])).toEqual(["admin"]);
  });

  test("does nothing without CLERK_SECRET_KEY (preview deployments)", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", undefined);
    const t = convexTest(schema, modules);

    const result = await t.action(internal.backfillUserRoles.run, {});

    expect(result).toEqual({ scanned: 0, patched: 0, deleted: 0 });
    expect(clerk.createClerkClient).not.toHaveBeenCalled();
  });
});
