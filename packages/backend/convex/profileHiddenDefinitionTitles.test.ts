import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// SEC-34: a definition's text is disclosed only by canViewDefinition (approved, or the viewer
// submitted it, or an admin). A solve row whose copy snapshot carries no title used to fall back to
// the definition's live title on the profile's solves list, records and "currently solving", so a
// profile quoted a rejected or pending title to anyone who opened it (anonymously, for the records).

const NOW = 1_700_000_000_000;
const PAGE = { numItems: 20, cursor: null };

type T = TestConvex<typeof schema>;

// Solver Sam (public profile, mutual with viewer Vera and sharing his in-progress solves) has one
// finished and one in-progress solve on a definition Pia submitted, with no snapshot title.
const seed = (t: T, status: "approved" | "pending" | "rejected" | "disabled") =>
  t.run(async (ctx) => {
    const user = (name: string, role?: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        role,
        createdAt: NOW,
        updatedAt: NOW,
      });
    const sam = await user("sam");
    const vera = await user("vera");
    const pia = await user("pia");
    await user("adam", "admin");
    await ctx.db.insert("profiles", {
      memberId: sam,
      visibility: "public",
      updatedAt: NOW,
    });
    for (const [followerId, followeeId] of [
      [sam, vera],
      [vera, sam],
    ] as const) {
      await ctx.db.insert("follows", {
        followerId,
        followeeId,
        createdAt: NOW,
      });
    }
    await ctx.db.insert("solvingPreferences", {
      memberId: sam,
      shareInProgress: true,
      updatedAt: NOW,
    });
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Hidden definition title",
      pieceCount: 4321,
      status,
      submittedBy: pia,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const solve = (isCompleted: boolean) => ({
      userId: sam,
      puzzleId: puzzle,
      startDate: NOW - 86_400_000,
      isCompleted,
      photos: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("completions", {
      ...solve(true),
      endDate: NOW,
      completionTimeMinutes: 90,
    });
    await ctx.db.insert("completions", solve(false));
    return { sam, puzzle };
  });

const as = (t: T, name: "vera" | "pia" | "sam") =>
  t.withIdentity({ subject: `clerk_${name}` });
const asAdmin = (t: T) =>
  t.withIdentity({ subject: "clerk_adam", metadata: { role: "admin" } });

type Viewer = ReturnType<typeof as>;

const profileSolves = (viewer: Viewer, memberId: Id<"users">) =>
  viewer.query(api.social.listProfileCompletions.listProfileCompletions, {
    memberId,
    paginationOpts: PAGE,
  });

const profileOf = async (viewer: T | Viewer, memberId: Id<"users">) => {
  const profile = await viewer.query(
    api.social.getPublicProfile.getPublicProfile,
    { handle: memberId as string },
  );
  if (!profile || profile.locked) throw new Error("expected an open profile");
  return profile;
};

describe("a profile quotes a live definition title only to a viewer who may open it", () => {
  for (const status of ["pending", "rejected", "disabled"] as const) {
    test(`${status}: the solves list names neither its title nor its pieces`, async () => {
      const t = convexTest(schema, modules);
      const { sam } = await seed(t, status);

      const { page } = await profileSolves(as(t, "vera"), sam);
      expect(page).toHaveLength(1);
      expect(page[0]?.title).toBeUndefined();
      expect(page[0]?.pieceCount).toBeUndefined();
      expect(JSON.stringify(page)).not.toContain("Hidden definition title");
    });

    test(`${status}: records and currently solving name nothing, anonymous or signed in`, async () => {
      const t = convexTest(schema, modules);
      const { sam } = await seed(t, status);

      const anonymous = await profileOf(t, sam);
      expect(anonymous.records).toEqual({ fastest: null, hardest: null });

      const mutual = await profileOf(as(t, "vera"), sam);
      expect(mutual.records).toEqual({ fastest: null, hardest: null });
      expect(mutual.currentlySolving).toHaveLength(1);
      expect(mutual.currentlySolving?.[0]?.title).toBeUndefined();
      expect(mutual.currentlySolving?.[0]?.pieceCount).toBeUndefined();
      expect(JSON.stringify(mutual)).not.toContain("Hidden definition title");
    });

    test(`${status}: the stats still count the pieces of a solve they can't name`, async () => {
      const t = convexTest(schema, modules);
      const { sam } = await seed(t, status);

      const { stats } = await profileOf(as(t, "vera"), sam);
      expect(stats.completions).toBe(1);
      expect(stats.piecesPlaced).toBe(4321);
    });

    test(`${status}: its submitter and an admin still read the title`, async () => {
      const t = convexTest(schema, modules);
      const { sam } = await seed(t, status);

      for (const viewer of [as(t, "pia"), asAdmin(t)]) {
        const { page } = await profileSolves(viewer, sam);
        expect(page[0]?.title).toBe("Hidden definition title");
        expect(page[0]?.pieceCount).toBe(4321);
        const { records } = await profileOf(viewer, sam);
        expect(records.hardest).toEqual({
          title: "Hidden definition title",
          pieceCount: 4321,
        });
      }
    });
  }

  test("approved: everyone reads the live title, as before", async () => {
    const t = convexTest(schema, modules);
    const { sam } = await seed(t, "approved");

    const { page } = await profileSolves(as(t, "vera"), sam);
    expect(page[0]?.title).toBe("Hidden definition title");
    expect(page[0]?.pieceCount).toBe(4321);

    const anonymous = await profileOf(t, sam);
    expect(anonymous.records.fastest).toEqual({
      title: "Hidden definition title",
      minutes: 90,
    });
    const mutual = await profileOf(as(t, "vera"), sam);
    expect(mutual.currentlySolving?.[0]?.title).toBe("Hidden definition title");
  });

  test("a snapshot title is the solve's own and stays, whatever the definition's status", async () => {
    const t = convexTest(schema, modules);
    const { sam } = await seed(t, "rejected");
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("completions").collect();
      for (const row of rows) {
        await ctx.db.patch(row._id, {
          copySnapshot: {
            copyId: "copy-aggregate",
            ownerId: sam,
            wasBorrowed: false,
            condition: "good",
            title: "Snapshot title",
            pieceCount: 500,
          },
        });
      }
    });

    const { page } = await profileSolves(as(t, "vera"), sam);
    expect(page[0]).toMatchObject({ title: "Snapshot title", pieceCount: 500 });
    const mutual = await profileOf(as(t, "vera"), sam);
    expect(mutual.records.hardest).toEqual({
      title: "Snapshot title",
      pieceCount: 500,
    });
    expect(mutual.currentlySolving?.[0]).toMatchObject({
      title: "Snapshot title",
      pieceCount: 500,
    });
  });
});

describe("the offer picker follows the copy views' title rule", () => {
  // Olive holds a copy of a definition Pia submitted. Its snapshot is what Olive acquired; the
  // definition's live title was edited or rejected after that and isn't hers to read.
  const seedOffer = (t: T, status: "approved" | "rejected") =>
    t.run(async (ctx) => {
      const user = (name: string) =>
        ctx.db.insert("users", {
          clerkId: `clerk_${name}`,
          email: `${name}@example.com`,
          name,
          isActive: true,
          createdAt: NOW,
          updatedAt: NOW,
        });
      const olive = await user("olive");
      const pia = await user("pia");
      const roy = await user("roy");
      const definition = (title: string, definitionStatus: typeof status) =>
        ctx.db.insert("puzzles", {
          title,
          brand: "Live brand",
          pieceCount: 4321,
          status: definitionStatus,
          submittedBy: pia,
          createdAt: NOW,
          updatedAt: NOW,
        });
      const copy = (
        ownerId: Id<"users">,
        puzzleId: Id<"puzzles">,
        forTrade: boolean,
      ) =>
        ctx.db.insert("ownedPuzzles", {
          puzzleId,
          ownerId,
          condition: "good",
          availability: { forTrade, forSale: false, forLend: false },
          snapshot: { title: "Snapshot title", brand: "Snap", pieceCount: 500 },
          createdAt: NOW,
          updatedAt: NOW,
        });
      await copy(olive, await definition("Live title", status), false);
      const requested = await copy(
        roy,
        await definition("Requested", "approved"),
        true,
      );
      return { requested };
    });

  const offerable = (t: T, requested: Id<"ownedPuzzles">) =>
    t
      .withIdentity({ subject: "clerk_olive" })
      .query(api.exchange.getOfferableCopies.getOfferableCopies, {
        requestedPuzzleId: requested,
      });

  test("a rejected definition: the copy's snapshot, not the live title", async () => {
    const t = convexTest(schema, modules);
    const { requested } = await seedOffer(t, "rejected");

    const [row] = await offerable(t, requested);
    expect(row).toMatchObject({
      title: "Snapshot title",
      brand: "Snap",
      pieceCount: 500,
    });
  });

  test("an approved definition: the catalogue's live facts, as My Puzzles shows them", async () => {
    const t = convexTest(schema, modules);
    const { requested } = await seedOffer(t, "approved");

    const [row] = await offerable(t, requested);
    expect(row).toMatchObject({
      title: "Live title",
      brand: "Live brand",
      pieceCount: 4321,
    });
  });
});
