import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Two members: Alice acts (admin ONLY via the JWT claim — her row mirror is set
// too, to prove the gate never reads it), Bob is the target.
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (
      clerkId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        searchableName: name.toLowerCase(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    const alice = await mkUser("clerk_alice", "Alice", { role: "admin" });
    const bob = await mkUser("clerk_bob", "Bob");
    return { alice, bob };
  });

const asMember = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });
const asAdmin = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice", metadata: { role: "admin" } });

const allActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

describe("admin/roleChange.gate", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await expect(
      t.query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("rejects a member without the JWT admin claim (even when their ROW mirror says admin)", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    // Alice's row carries role "admin" (display mirror) but her identity has no
    // metadata.role claim — the gate must still refuse her.
    await expect(
      asMember(t).query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toThrow(/Forbidden/);
  });

  test("rejects a self-change with CannotChangeOwnRole", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    await expect(
      asAdmin(t).query(internal.admin.roleChange.gate, { userId: alice }),
    ).rejects.toThrow(/CannotChangeOwnRole/);
  });

  test("rejects when the target row no longer exists", async () => {
    const t = convexTest(schema, modules);
    const { bob } = await seed(t);
    await t.run((ctx) => ctx.db.delete(bob));
    await expect(
      asAdmin(t).query(internal.admin.roleChange.gate, { userId: bob }),
    ).rejects.toThrow(/User not found/);
  });

  test("returns clerkId, name and the acting admin's id for a valid target", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    const result = await asAdmin(t).query(internal.admin.roleChange.gate, {
      userId: bob,
    });
    expect(result).toEqual({
      clerkId: "clerk_bob",
      name: "Bob",
      actorId: alice,
    });
  });
});

describe("admin/roleChange.apply", () => {
  test("grant patches the display mirror and stamps role_granted", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: "admin",
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const row = await t.run((ctx) => ctx.db.get(bob));
    expect(row?.role).toBe("admin");
    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "role_granted",
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
    expect(typeof actions[0].at).toBe("number");
  });

  test("revoke clears the mirror and stamps role_revoked", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.run((ctx) => ctx.db.patch(bob, { role: "admin" }));
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const row = await t.run((ctx) => ctx.db.get(bob));
    expect(row?.role).toBeUndefined();
    const actions = await allActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      actorId: alice,
      kind: "role_revoked",
      targetLabel: "Bob",
      targetId: "clerk_bob",
    });
  });

  test("stamps are append-only additions to moderationActions", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob } = await seed(t);
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: "admin",
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    await t.mutation(internal.admin.roleChange.apply, {
      userId: bob,
      role: null,
      actorId: alice,
      clerkId: "clerk_bob",
      name: "Bob",
    });
    const actions = await allActions(t);
    expect(actions.map((a) => a.kind)).toEqual([
      "role_granted",
      "role_revoked",
    ]);
  });
});
