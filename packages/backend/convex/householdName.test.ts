import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// The household name: admin-only, normalised like circle names (1-100 chars), and returned only to
// members of that household — never to an invitee, a link holder or anyone else.

type T = TestConvex<typeof schema>;
type Who = "ann" | "bob" | "cat";

const seed = async (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (clerkId: string, name: string) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    return {
      ann: await mkUser("clerk_ann", "Ann"),
      bob: await mkUser("clerk_bob", "Bob"),
      cat: await mkUser("clerk_cat", "Cat"),
    };
  });

const as = (t: T, who: Who) => t.withIdentity({ subject: `clerk_${who}` });

const codeOf = (e: unknown): string | undefined => {
  const data = (e as ConvexError<Value>).data;
  return (typeof data === "string" ? JSON.parse(data) : data)?.code;
};

const rename = (t: T, who: Who, name: string | null) =>
  as(t, who).mutation(api.household.renameHousehold.renameHousehold, {
    name,
  });

const mine = (t: T, who: Who) =>
  as(t, who).query(api.household.getMyHousehold.getMyHousehold, {});

// Ann founds a household, Bob joins it.
const annAndBob = async (t: T) => {
  const s = await seed(t);
  await as(t, "ann").mutation(
    api.household.createHousehold.createHousehold,
    {},
  );
  const inviteId = await as(t, "ann").mutation(
    api.household.inviteToHousehold.inviteToHousehold,
    { inviteeId: s.bob },
  );
  await as(t, "bob").mutation(
    api.household.acceptHouseholdInvite.acceptHouseholdInvite,
    { inviteId },
  );
  return s;
};

describe("household name", () => {
  test("the admin names the household; every member sees it, normalised", async () => {
    const t = convexTest(schema, modules);
    await annAndBob(t);
    await rename(t, "ann", "  The\n Smiths ");
    expect((await mine(t, "ann"))?.name).toBe("The Smiths");
    expect((await mine(t, "bob"))?.name).toBe("The Smiths");
  });

  test("an unnamed household has no name; null clears it", async () => {
    const t = convexTest(schema, modules);
    await annAndBob(t);
    expect(await mine(t, "ann")).not.toHaveProperty("name");
    await rename(t, "ann", "Home");
    await rename(t, "ann", null);
    expect(await mine(t, "bob")).not.toHaveProperty("name");
  });

  test("a non-admin member cannot rename", async () => {
    const t = convexTest(schema, modules);
    await annAndBob(t);
    await expect(rename(t, "bob", "Bob's")).rejects.toSatisfy(
      (e) => codeOf(e) === "NotHouseholdAdmin",
    );
  });

  test("names outside 1-100 visible characters are refused", async () => {
    const t = convexTest(schema, modules);
    await annAndBob(t);
    for (const bad of ["", "   ", "​", "x".repeat(101)]) {
      await expect(rename(t, "ann", bad)).rejects.toSatisfy(
        (e) => codeOf(e) === "InvalidHouseholdName",
      );
    }
    await rename(t, "ann", "x".repeat(100));
    expect((await mine(t, "ann"))?.name).toBe("x".repeat(100));
  });

  test("someone without a household cannot rename", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(rename(t, "cat", "Mine")).rejects.toSatisfy(
      (e) => codeOf(e) === "NotInHousehold",
    );
  });

  test("the name never reaches a non-member: invitee, link holder or ex-member", async () => {
    const t = convexTest(schema, modules);
    const s = await annAndBob(t);
    await rename(t, "ann", "Secret Name");

    // Cat holds a pending invite and a live link from Ann.
    await as(t, "ann").mutation(
      api.household.inviteToHousehold.inviteToHousehold,
      { inviteeId: s.cat },
    );
    const { token } = await as(t, "ann").mutation(
      api.social.createHouseholdInviteLink.createHouseholdInviteLink,
      {},
    );
    const seen = JSON.stringify([
      await mine(t, "cat"),
      await as(t, "cat").query(
        api.household.listMyHouseholdInvites.listMyHouseholdInvites,
        {},
      ),
      await as(t, "cat").query(
        api.social.getHouseholdLinkInvite.getHouseholdLinkInvite,
        { token },
      ),
    ]);
    expect(seen).not.toContain("Secret Name");

    // Bob leaves: the name goes with his membership.
    await as(t, "bob").mutation(
      api.household.leaveHousehold.leaveHousehold,
      {},
    );
    expect(await mine(t, "bob")).toBeNull();
  });
});
