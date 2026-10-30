import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
const HOUR = 60 * 60 * 1000;

// SEC-34: the definition page (getPuzzleDefinitionView) answers "not found" for a pending,
// rejected or disabled definition unless the viewer submitted it or is an admin. Every read that
// hands the client a link to that page must apply the same gate (canViewDefinition), so nobody is
// sent to a dead page: the activity feed, the profile solves list, the member's own solve log and
// the copy page's "View puzzle page" link.

const HIDDEN = ["pending", "rejected", "disabled"] as const;

// alice owns and solves a copy; bob follows her; sam submitted the definition. The definition
// starts approved so the copy can be acquired and solved through the real mutations.
const seed = (t: TestConvex<typeof schema>) =>
  t.run(async (ctx) => {
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
    const sam = await mkUser("sam");
    const definitionId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: definitionId,
      title: "Mountain Vista",
      pieceCount: 1000,
      searchableText: "Mountain Vista",
      status: "approved",
      submittedBy: sam,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("follows", {
      followerId: bob,
      followeeId: alice,
      createdAt: now,
    });
    return { alice, bob, sam, definitionId, puzzleId };
  });

const asUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}` });
const asAdminUser = (t: TestConvex<typeof schema>, name: string) =>
  t.withIdentity({ subject: `clerk_${name}`, metadata: { role: "admin" } });

// alice acquires a copy (open for trade when `open`, otherwise unreachable for bob) and logs a
// finished solve of it. Returns the copy's doc _id.
const ownAndSolve = async (
  t: TestConvex<typeof schema>,
  definitionId: string,
  open: boolean,
): Promise<Id<"ownedPuzzles">> => {
  const copyId = await asUser(t, "alice").mutation(
    api.library.acquireCopy.acquireCopy,
    { puzzleDefinitionId: definitionId, condition: "good" },
  );
  if (open) {
    await asUser(t, "alice").mutation(
      api.library.updateCopySharing.updateCopySharing,
      { copyId, visibility: "visible", forTrade: true },
    );
  }
  await asUser(t, "alice").mutation(
    api.solving.recordCompletion.recordCompletion,
    {
      copyId,
      startDate: Date.now() - 2 * HOUR,
      endDate: Date.now() - HOUR,
    },
  );
  return t.run(async (ctx) => {
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", copyId))
      .unique();
    return copy!._id;
  });
};

const setStatus = (
  t: TestConvex<typeof schema>,
  puzzleId: Id<"puzzles">,
  status: "pending" | "approved" | "rejected" | "disabled",
) => t.run((ctx) => ctx.db.patch(puzzleId, { status }));

type Caller = ReturnType<typeof asUser>;

const feedCompletionTarget = async (caller: Caller) =>
  (await caller.query(api.social.getActivityFeed.getActivityFeed, {})).find(
    (e) => e.kind === "completion",
  )?.target;

const profileCompletionLink = async (caller: Caller, memberId: Id<"users">) =>
  (
    await caller.query(
      api.social.listProfileCompletions.listProfileCompletions,
      { memberId, paginationOpts: { numItems: 10, cursor: null } },
    )
  ).page[0]?.link;

const ownCompletionLink = async (caller: Caller) =>
  (await caller.query(api.solving.listMyCompletions.listMyCompletions, {}))[0]
    ?.link;

describe("links to a non-approved definition follow its read gate (SEC-34)", () => {
  test.each(HIDDEN)(
    "a follower's feed entry and the profile solve list give no link to a %s definition",
    async (status) => {
      const t = convexTest(schema, modules);
      const { alice, definitionId, puzzleId } = await seed(t);
      await ownAndSolve(t, definitionId, false);

      // Approved: the hidden copy falls back to the definition page.
      const definitionLink = { kind: "definition", id: puzzleId as string };
      expect(await feedCompletionTarget(asUser(t, "bob"))).toEqual(
        definitionLink,
      );
      expect(await profileCompletionLink(asUser(t, "bob"), alice)).toEqual(
        definitionLink,
      );

      await setStatus(t, puzzleId, status);
      expect(await feedCompletionTarget(asUser(t, "bob"))).toBeUndefined();
      expect(
        await profileCompletionLink(asUser(t, "bob"), alice),
      ).toBeUndefined();

      // An admin may still open it, so keeps the link.
      expect(await feedCompletionTarget(asAdminUser(t, "bob"))).toEqual(
        definitionLink,
      );
    },
  );

  test("the submitter keeps the definition link while it is pending", async () => {
    const t = convexTest(schema, modules);
    const { alice, bob, definitionId, puzzleId } = await seed(t);
    await ownAndSolve(t, definitionId, false);
    await t.run((ctx) =>
      ctx.db.patch(puzzleId, { status: "pending", submittedBy: bob }),
    );

    const definitionLink = { kind: "definition", id: puzzleId as string };
    expect(await feedCompletionTarget(asUser(t, "bob"))).toEqual(
      definitionLink,
    );
    expect(await profileCompletionLink(asUser(t, "bob"), alice)).toEqual(
      definitionLink,
    );
  });

  test.each(HIDDEN)(
    "the member's own solve log gives no link to a %s definition once the copy is gone",
    async (status) => {
      const t = convexTest(schema, modules);
      const { definitionId, puzzleId } = await seed(t);
      const copy = await ownAndSolve(t, definitionId, false);
      await t.run((ctx) => ctx.db.delete(copy));

      expect(await ownCompletionLink(asUser(t, "alice"))).toEqual({
        kind: "definition",
        id: puzzleId as string,
      });
      await setStatus(t, puzzleId, status);
      expect(await ownCompletionLink(asUser(t, "alice"))).toBeUndefined();
    },
  );

  test.each(HIDDEN)(
    "the copy page offers the definition page of a %s definition only to its submitter or an admin",
    async (status) => {
      const t = convexTest(schema, modules);
      const { alice, definitionId, puzzleId } = await seed(t);
      const copyId = await ownAndSolve(t, definitionId, true);
      const mayOpen = async (caller: Caller) =>
        (
          await caller.query(
            api.library.getCopyInstanceView.getCopyInstanceView,
            { copyId },
          )
        )?.viewerMayOpenDefinition;

      for (const caller of [asUser(t, "bob"), asUser(t, "alice")]) {
        expect(await mayOpen(caller)).toBe(true);
      }

      await setStatus(t, puzzleId, status);
      // The copy's owner did not submit the definition, so the page would answer "not found"
      // for her too.
      for (const caller of [asUser(t, "bob"), asUser(t, "alice")]) {
        expect(await mayOpen(caller)).toBe(false);
      }
      expect(await mayOpen(asAdminUser(t, "bob"))).toBe(true);
      await t.run((ctx) => ctx.db.patch(puzzleId, { submittedBy: alice }));
      expect(await mayOpen(asUser(t, "alice"))).toBe(true);
    },
  );
});
