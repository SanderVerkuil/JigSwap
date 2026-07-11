import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUsers = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const bob = await ctx.db.insert("users", {
      clerkId: "clerk_bob",
      email: "bob@example.com",
      name: "Bob",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { alice, bob };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("getMyInviteLink", () => {
  test("creates a token on first call and returns the same one after", async () => {
    const t = convexTest(schema, modules);
    await seedUsers(t);

    const first = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(first.token).toMatch(/^[a-f0-9]{32}$/);

    const second = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(second.token).toBe(first.token);
  });
});

describe("resetInviteLink", () => {
  test("revokes the active token and issues a different one", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seedUsers(t);

    const original = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    const reset = await asAlice(t).mutation(
      api.social.resetInviteLink.resetInviteLink,
      {},
    );
    expect(reset.token).not.toBe(original.token);

    // Old row is revoked, new row is active
    const rows = await t.run((ctx) =>
      ctx.db
        .query("inviteLinks")
        .withIndex("by_owner", (q) => q.eq("ownerId", alice))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.token === original.token)?.revokedAt).toBeTypeOf(
      "number",
    );
    expect(
      rows.find((r) => r.token === reset.token)?.revokedAt,
    ).toBeUndefined();

    // getMyInviteLink now returns the new token
    const after = await asAlice(t).mutation(
      api.social.getMyInviteLink.getMyInviteLink,
      {},
    );
    expect(after.token).toBe(reset.token);
  });
});
