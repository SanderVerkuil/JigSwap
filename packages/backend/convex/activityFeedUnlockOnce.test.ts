import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { canSeeProfileContent } from "./social/privacy";

// The feed decides each actor's profile unlock (SEC-43) once per read, in gateCandidates' memo.
// Linking a solve to its copy must not ask the same question again for every entry.

// Calls straight through to the real rule, so what the feed shows is unaffected.
vi.mock("./social/privacy", async (importActual) => {
  const actual = await importActual<typeof import("./social/privacy")>();
  return {
    ...actual,
    canSeeProfileContent: vi.fn(actual.canSeeProfileContent),
  };
});

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

test("three solves by one actor check that actor's profile unlock once, and still link to the copy", async () => {
  const t = convexTest(schema, modules);
  // alice solves; bob follows her. alice has no profile row, so she reads as public.
  const { alice, definitionId } = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    const alice = await mkUser("alice");
    const bob = await mkUser("bob");
    const definitionId = crypto.randomUUID();
    await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      searchableText: "Mountain Vista",
      status: "approved",
      submittedBy: bob,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    return { alice, definitionId };
  });
  const asAlice = t.withIdentity({ subject: "clerk_alice" });
  const copyId = await asAlice.mutation(api.library.acquireCopy.acquireCopy, {
    puzzleDefinitionId: definitionId,
    condition: "good",
  });
  await asAlice.mutation(api.library.updateCopySharing.updateCopySharing, {
    copyId,
    visibility: "visible",
    forTrade: true,
  });
  for (let i = 0; i < 3; i++) {
    await asAlice.mutation(api.solving.recordCompletion.recordCompletion, {
      copyId,
      startDate: Date.now() - (2 * i + 2) * HOUR,
      endDate: Date.now() - (2 * i + 1) * HOUR,
    });
  }

  vi.mocked(canSeeProfileContent).mockClear();
  const feed = await t
    .withIdentity({ subject: "clerk_bob" })
    .query(api.social.getActivityFeed.getActivityFeed, {});

  const solves = feed.filter((e) => e.kind === "completion");
  expect(solves).toHaveLength(3);
  for (const solve of solves) expect(solve.target?.kind).toBe("copy");
  const aliceChecks = vi
    .mocked(canSeeProfileContent)
    .mock.calls.filter(([, , memberId]) => memberId === alice);
  expect(aliceChecks).toHaveLength(1);
});
