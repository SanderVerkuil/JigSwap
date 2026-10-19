import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { optionalActingMember } from "./identity/optionalActingMember";
import schema from "./schema";

// #275: a deactivated (tombstoned) member whose Clerk session is still valid must not pass the
// requireMember gate, and optionalActingMember must treat them as anonymous.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const mkUser = (t: T, clerkId: string, isActive: boolean) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name: clerkId,
      username: clerkId,
      isActive,
      createdAt: now,
      updatedAt: now,
    });
  });

const as = (t: T, clerkId: string) => t.withIdentity({ subject: clerkId });

const rejection = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<string>).data;
};

describe("requireMember refuses deactivated members", () => {
  test("an active member passes a gated query and mutation", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "alice", true);

    await expect(
      as(t, "alice").query(api.settings.getMyUserSettings.getMyUserSettings),
    ).resolves.toBeDefined();
    await expect(
      as(t, "alice").mutation(api.users.updateUserProfile, { bio: "hi" }),
    ).resolves.toBeNull();
  });

  test("a deactivated member gets the same error as a missing row", async () => {
    const t = convexTest(schema, modules);
    await mkUser(t, "tomb", false);

    const missing = await rejection(
      as(t, "nobody").query(api.settings.getMyUserSettings.getMyUserSettings),
    );
    expect(missing).toBe("Member not found");
    expect(
      await rejection(
        as(t, "tomb").query(api.settings.getMyUserSettings.getMyUserSettings),
      ),
    ).toBe(missing);
    expect(
      await rejection(
        as(t, "tomb").mutation(api.users.updateUserProfile, { bio: "hi" }),
      ),
    ).toBe(missing);
  });
});

describe("optionalActingMember treats a deactivated member as anonymous", () => {
  test("active member resolves; deactivated member yields null", async () => {
    const t = convexTest(schema, modules);
    const alice = await mkUser(t, "alice", true);
    await mkUser(t, "tomb", false);

    expect(await as(t, "alice").run((ctx) => optionalActingMember(ctx))).toBe(
      alice,
    );
    expect(
      await as(t, "tomb").run((ctx) => optionalActingMember(ctx)),
    ).toBeNull();
  });
});
