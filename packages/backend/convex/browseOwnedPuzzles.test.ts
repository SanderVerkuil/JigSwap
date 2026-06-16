import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const OPEN = { forTrade: true, forSale: false, forLend: false };
const CLOSED = { forTrade: false, forSale: false, forLend: false };

const asViewer = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_viewer" });

// Seed the viewer plus three other members (public / private / private-in-circle), a shared puzzle
// definition, and a copy for each member. Circle membership and a circle-copy-share are wired
// exactly as `collectCircleSharedCopies` reads them: `circleMembers.by_member` for the viewer's
// circles, `circleCopyShares.by_circle` keyed on the circle aggregateId, and copy resolution via
// `ownedPuzzles.by_aggregate_id`.
const seed = async (t: ReturnType<typeof convexTest>) =>
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

    const viewer = await mkUser("clerk_viewer", "Viewer");
    const publicOwner = await mkUser("clerk_public", "Pubby");
    const privateOwner = await mkUser("clerk_private", "Priv");
    const circleOwner = await mkUser("clerk_circle", "Circ");

    // Profile visibility: publicOwner defaults to public (no row), the other two are explicit.
    await ctx.db.insert("profiles", {
      memberId: privateOwner,
      displayName: "Priv",
      visibility: "private",
      updatedAt: now,
    });
    await ctx.db.insert("profiles", {
      memberId: circleOwner,
      displayName: "Circ",
      visibility: "private",
      updatedAt: now,
    });

    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Mountain Vista",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: viewer,
      createdAt: now,
      updatedAt: now,
    });

    const mkCopy = (
      aggregateId: string,
      ownerId: Id<"users">,
      availability: { forTrade: boolean; forSale: boolean; forLend: boolean },
    ) =>
      ctx.db.insert("ownedPuzzles", {
        aggregateId,
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability,
        createdAt: now,
        updatedAt: now,
      });

    // Viewer's own OPEN copy (excluded from Browse by default).
    await mkCopy("copy-own", viewer, OPEN);
    // Public owner: OPEN (shown) and CLOSED (excluded — not open).
    await mkCopy("copy-public-open", publicOwner, OPEN);
    await mkCopy("copy-public-closed", publicOwner, CLOSED);
    // Private owner, no circle: OPEN copy is HIDDEN (private, unreachable).
    await mkCopy("copy-private-hidden", privateOwner, OPEN);
    // Private owner in a shared circle: OPEN copy is SHOWN via the circle path.
    await mkCopy("copy-circle-open", circleOwner, OPEN);

    // Circle wiring: viewer and circleOwner both belong to "circle-1"; the OPEN circle copy is
    // shared into it (keyed by the copy's aggregateId, per the read helper).
    const circleAggregateId = "circle-1";
    await ctx.db.insert("circles", {
      aggregateId: circleAggregateId,
      ownerId: circleOwner,
      name: "Saturday Puzzlers",
      memberships: [
        {
          id: "m-owner",
          memberId: circleOwner,
          permission: "Admin",
          joinedAt: now,
        },
        {
          id: "m-viewer",
          memberId: viewer,
          permission: "ViewOnly",
          joinedAt: now,
        },
      ],
      createdAt: now,
    });
    for (const memberId of [circleOwner, viewer]) {
      await ctx.db.insert("circleMembers", {
        circleAggregateId,
        memberId,
      });
    }
    await ctx.db.insert("circleCopyShares", {
      circleId: circleAggregateId,
      copyId: "copy-circle-open",
      sharedAt: now,
    });

    return { viewer };
  });

const browse = async (
  t: ReturnType<typeof convexTest>,
  args: Record<string, unknown> = {},
) => asViewer(t).query(api.library.browseOwnedPuzzles.browseOwnedPuzzles, args);

const ids = (view: { ownedPuzzles: { aggregateId?: string }[] }) =>
  new Set(view.ownedPuzzles.map((c) => c.aggregateId));

describe("library.browseOwnedPuzzles privacy gating", () => {
  test("the viewer's OWN available copy is excluded by default", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-own")).toBe(false);
  });

  test("the viewer's OWN available copy is included with includeOwnPuzzles", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t, { includeOwnPuzzles: true });
    expect(ids(view).has("copy-own")).toBe(true);
  });

  test("a PUBLIC owner's open copy is shown", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-public-open")).toBe(true);
  });

  test("a PUBLIC owner's NON-open copy is excluded", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-public-closed")).toBe(false);
  });

  test("a PRIVATE owner's open copy with no shared circle is HIDDEN", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-private-hidden")).toBe(false);
  });

  test("a PRIVATE owner's open copy that is circle-shared with the viewer is shown", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const view = await browse(t);
    expect(ids(view).has("copy-circle-open")).toBe(true);
  });

  test("another member's copy never carries owner-only fields", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    // Stamp the public owner's open copy with owner-only data; browsing it as the viewer must never
    // surface notes / acquisition provenance.
    await t.run(async (ctx) => {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", "copy-public-open"),
        )
        .unique();
      if (copy) {
        await ctx.db.patch(copy._id, {
          notes: "owner private notes",
          acquisitionPrice: { amount: 42, currency: "EUR" },
          acquisitionSource: "bought_new",
        });
      }
    });

    const view = await browse(t);
    const shown = view.ownedPuzzles.find(
      (c) => c.aggregateId === "copy-public-open",
    );
    expect(shown).toBeDefined();
    expect(shown?.notes).toBeUndefined();
    expect(shown?.acquisitionPrice).toBeUndefined();
    expect(shown?.acquisitionSource).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("owner private notes");
  });
});
