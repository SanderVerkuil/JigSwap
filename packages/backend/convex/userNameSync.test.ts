import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Minimal Clerk UserJSON stand-in. Clerk sends `null` (not absent) for a missing first/last name —
// e.g. an email-only or OAuth sign-up that never filled in a name.
const clerkUser = (
  first_name: string | null,
  last_name: string | null,
  username: string | null = null,
) => ({
  id: "clerk_anon",
  first_name,
  last_name,
  username,
  email_addresses: [{ email_address: "anon@example.com" }],
  image_url: "https://img.clerk.com/anon.png",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
  public_metadata: {},
});

const findRow = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) =>
    ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "clerk_anon"))
      .unique(),
  );

describe("users/updateOrCreateUser name sync", () => {
  test('a Clerk user with no first/last name is stored without a name, not "null null"', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser(null, null),
    });
    const row = await findRow(t);
    expect(row?.name).toBeUndefined();
    expect(row?.searchableName ?? "").not.toContain("null");
  });

  test("only the present half of the name is kept", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser("Mara", null, "mara"),
    });
    const row = await findRow(t);
    expect(row?.name).toBe("Mara");
    expect(row?.searchableName).toBe("mara mara");
  });

  test("blank names are treated as missing", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser("  ", "", "anon"),
    });
    const row = await findRow(t);
    expect(row?.name).toBeUndefined();
    expect(row?.searchableName).toBe("anon");
  });

  test("an update that removes the name in Clerk clears it", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser("Mara", "Jansen"),
    });
    expect((await findRow(t))?.name).toBe("Mara Jansen");
    await t.mutation(internal.users.updateOrCreateUser, {
      clerkUser: clerkUser(null, null),
    });
    expect((await findRow(t))?.name).toBeUndefined();
  });
});
