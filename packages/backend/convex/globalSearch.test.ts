import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const insertUser = (
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  name: string,
  username: string,
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@example.com`,
      name,
      username,
      searchableName: `${name} ${username}`.toLowerCase(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const setVisibility = (
  t: ReturnType<typeof convexTest>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      memberId,
      displayName: "x",
      visibility,
      updatedAt: Date.now(),
    });
  });

const follow = (
  t: ReturnType<typeof convexTest>,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", { followerId, followeeId, createdAt: 1 });
  });

const asUser = (t: ReturnType<typeof convexTest>, clerkId: string) =>
  t.withIdentity({ subject: clerkId });

describe("search.global people results", () => {
  test("finds a public member via the name/username search index", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    await insertUser(t, "clerk_target", "Patricia Public", "patricia");

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "patricia" },
    );
    expect(res.people.map((p) => p.name)).toContain("Patricia Public");
  });

  test("hides a private-profile member from a non-connected searcher", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_searcher", "Sam Searcher", "sam");
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "priv" },
    );
    expect(res.people).toHaveLength(0);
  });

  test("reveals a private member to a mutual follower", async () => {
    const t = convexTest(schema, modules);
    const searcher = await insertUser(
      t,
      "clerk_searcher",
      "Sam Searcher",
      "sam",
    );
    const target = await insertUser(t, "clerk_priv", "Priv Person", "priv");
    await setVisibility(t, target, "private");
    await follow(t, searcher, target);
    await follow(t, target, searcher);

    const res = await asUser(t, "clerk_searcher").query(
      api.search.globalSearch.global,
      { term: "priv" },
    );
    expect(res.people.map((p) => p.name)).toContain("Priv Person");
  });

  test("excludes the searcher themself from people results", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "clerk_self", "Self Searcher", "self");

    const res = await asUser(t, "clerk_self").query(
      api.search.globalSearch.global,
      { term: "self" },
    );
    expect(res.people).toHaveLength(0);
  });
});
