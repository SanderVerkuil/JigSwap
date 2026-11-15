import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { requireAdmin } from "./identity/isAdmin";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const setup = async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "clerk_a",
      email: "a@example.com",
      name: "A",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  return { t, id };
};

describe("requireAdmin", () => {
  test("returns the admin's user id", async () => {
    const { t, id } = await setup();
    const got = await t
      .withIdentity({ subject: "clerk_a", metadata: { role: "admin" } })
      .run((ctx) => requireAdmin(ctx));
    expect(got).toBe(id);
  });

  test("refuses a member who is not an admin", async () => {
    const { t } = await setup();
    await expect(
      t.withIdentity({ subject: "clerk_a" }).run((ctx) => requireAdmin(ctx)),
    ).rejects.toThrow("Forbidden");
  });

  test("refuses an unauthenticated caller", async () => {
    const { t } = await setup();
    await expect(t.run((ctx) => requireAdmin(ctx))).rejects.toThrow(
      "Unauthenticated",
    );
  });
});
