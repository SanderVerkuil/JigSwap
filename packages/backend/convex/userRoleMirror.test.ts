import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Minimal Clerk UserJSON stand-in: updateOrCreateUser reads exactly these fields
// (its args are v.any() — the webhook trusts Clerk).
const clerkUser = (publicMetadata: Record<string, unknown>) => ({
  id: "clerk_mara",
  first_name: "Mara",
  last_name: "Jansen",
  username: "mara",
  email_addresses: [{ email_address: "mara@example.com" }],
  image_url: "https://img.clerk.com/mara.png",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  public_metadata: publicMetadata,
});

const findMara = (t: ReturnType<typeof convexTest>) =>
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
