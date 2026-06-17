import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const asViewer = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_viewer" });

type AnyEntry = {
  type: string;
  from?: unknown;
  to?: unknown;
  solver?: unknown;
  lender?: unknown;
  borrower?: unknown;
};

// Collect every ProjectedMember object out of a timeline entry.
const participants = (e: AnyEntry): unknown[] =>
  [e.from, e.to, e.solver, e.lender, e.borrower].filter((p) => p != null);

type View = {
  before: AnyEntry[];
  since: AnyEntry[];
} | null;

// Find a transfer entry anywhere in the timeline (since OR before).
const findTransfer = (view: View): AnyEntry | undefined =>
  [...(view?.before ?? []), ...(view?.since ?? [])].find(
    (e) => e.type === "transfer",
  );

const mkUser = (ctx: MutationCtx, clerkId: string, name: string, now: number) =>
  ctx.db.insert("users", {
    clerkId,
    email: `${clerkId}@example.com`,
    name,
    username: clerkId,
    avatar: `https://avatars/${clerkId}.png`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

// Seed a single copy currently owned by the viewer that was previously held by `prevOwner` (a
// historical custody transfer). Returns the user ids + copy id so each test sets visibility/follows.
const seedCopy = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = 1_000_000;
    const viewer = await mkUser(ctx, "clerk_viewer", "Viewer", now);
    const prevOwner = await mkUser(ctx, "clerk_prev", "Prev Owner", now);
    const solver = await mkUser(ctx, "clerk_solver", "Solver", now);

    const puzzle = await ctx.db.insert("puzzles", {
      aggregateId: "def-1",
      title: "Secret Garden",
      brand: "Ravensburger",
      pieceCount: 1000,
      status: "approved",
      submittedBy: viewer,
      createdAt: now,
      updatedAt: now,
    });

    // Copy created BEFORE the transfer; viewer acquired it via the transfer at now+100.
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: "copy-1",
      puzzleId: puzzle,
      ownerId: viewer,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      createdAt: now,
      updatedAt: now,
    });

    // Ownership transfer prevOwner -> viewer (custody projection keyed by the copy _id).
    await ctx.db.insert("copyCustodyEntries", {
      copyId: copy as string,
      exchangeId: "exch-1",
      previousOwner: prevOwner as string,
      newOwner: viewer as string,
      occurredAt: now + 100,
    });

    return { now, viewer, prevOwner, solver, copy };
  });

const setVisibility = (
  t: ReturnType<typeof convexTest>,
  memberId: Id<"users">,
  visibility: "public" | "private",
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("profiles", {
      aggregateId: `prof-${memberId}`,
      memberId,
      displayName: "X",
      visibility,
      updatedAt: 1,
    });
  });

const follow = (
  t: ReturnType<typeof convexTest>,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("follows", {
      followerId,
      followeeId,
      createdAt: 1,
    });
  });

describe("getCopyInstanceView privacy gating", () => {
  test("self is shown real even when the viewer's own profile is private", async () => {
    const t = convexTest(schema, modules);
    const { viewer, copy } = await seedCopy(t);
    await setVisibility(t, viewer, "private");

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view).not.toBeNull();
    expect(view?.owner).toEqual({
      anonymous: false,
      member: expect.objectContaining({ _id: viewer, name: "Viewer" }),
    });
    expect(view?.viewerIsOwner).toBe(true);
  });

  test("a PUBLIC historical participant is revealed", async () => {
    const t = convexTest(schema, modules);
    const { prevOwner, copy } = await seedCopy(t);
    await setVisibility(t, prevOwner, "public");

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    const transfer = findTransfer(view as View);
    expect(transfer).toBeDefined();
    expect(transfer?.from).toEqual({
      anonymous: false,
      member: expect.objectContaining({ name: "Prev Owner" }),
    });
  });

  test("a PRIVATE participant with no follow is anonymous — NO real identity leaks", async () => {
    const t = convexTest(schema, modules);
    const { prevOwner, copy } = await seedCopy(t);
    await setVisibility(t, prevOwner, "private");

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    const transfer = findTransfer(view as View) as {
      from: { anonymous: boolean; anonRef?: string };
    };
    expect(transfer.from.anonymous).toBe(true);
    expect(transfer.from.anonRef).toEqual(expect.any(String));

    // Adversarial: nowhere in the serialized result may the hidden member's id/name/username/avatar
    // appear.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(prevOwner as string);
    expect(serialized).not.toContain("Prev Owner");
    expect(serialized).not.toContain("clerk_prev");
    expect(serialized).not.toContain("avatars/clerk_prev");
    // The projected object has exactly the two anon keys, nothing else.
    expect(Object.keys(transfer.from).sort()).toEqual(["anonRef", "anonymous"]);
  });

  test("a PRIVATE participant with only a ONE-WAY follow stays anonymous (mutual required)", async () => {
    // viewer -> prevOwner only.
    const t1 = convexTest(schema, modules);
    const s1 = await seedCopy(t1);
    await setVisibility(t1, s1.prevOwner, "private");
    await follow(t1, s1.viewer, s1.prevOwner);
    const v1 = await asViewer(t1).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s1.copy },
    );
    const t1from = (
      findTransfer(v1 as View) as { from: { anonymous: boolean } }
    ).from;
    expect(t1from.anonymous).toBe(true);

    // prevOwner -> viewer only.
    const t2 = convexTest(schema, modules);
    const s2 = await seedCopy(t2);
    await setVisibility(t2, s2.prevOwner, "private");
    await follow(t2, s2.prevOwner, s2.viewer);
    const v2 = await asViewer(t2).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: s2.copy },
    );
    const t2from = (
      findTransfer(v2 as View) as { from: { anonymous: boolean } }
    ).from;
    expect(t2from.anonymous).toBe(true);
  });

  test("a PRIVATE participant with MUTUAL follow is revealed", async () => {
    const t = convexTest(schema, modules);
    const { viewer, prevOwner, copy } = await seedCopy(t);
    await setVisibility(t, prevOwner, "private");
    await follow(t, viewer, prevOwner);
    await follow(t, prevOwner, viewer);

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    const transfer = findTransfer(view as View) as {
      from: { anonymous: boolean; member?: { name: string } };
    };
    expect(transfer.from.anonymous).toBe(false);
    expect(transfer.from.member?.name).toBe("Prev Owner");
  });

  test("anonRef is stable for one hidden member across entries, and salted by copyId", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, prevOwner, copy } = await seedCopy(t);
    await setVisibility(t, prevOwner, "private");

    // Add a SECOND transfer entry involving the same hidden prevOwner on the same copy, plus a
    // second copy whose transfer also involves prevOwner so we can compare salts.
    const otherCopy = await t.run(async (ctx) => {
      // second custody entry on the SAME copy (viewer -> prevOwner -> viewer round trip).
      await ctx.db.insert("copyCustodyEntries", {
        copyId: copy as string,
        exchangeId: "exch-2",
        previousOwner: viewer as string,
        newOwner: prevOwner as string,
        occurredAt: now + 50,
      });

      const puzzle2 = await ctx.db.insert("puzzles", {
        aggregateId: "def-2",
        title: "Other",
        pieceCount: 500,
        status: "approved",
        submittedBy: viewer,
        createdAt: now,
        updatedAt: now,
      });
      const c2 = await ctx.db.insert("ownedPuzzles", {
        aggregateId: "copy-2",
        puzzleId: puzzle2,
        ownerId: viewer,
        condition: "good",
        availability: { forTrade: false, forSale: false, forLend: false },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("copyCustodyEntries", {
        copyId: c2 as string,
        exchangeId: "exch-3",
        previousOwner: prevOwner as string,
        newOwner: viewer as string,
        occurredAt: now + 100,
      });
      return c2;
    });

    const v1 = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    // Every anonymous reference to prevOwner within this one timeline must be identical.
    const refs = new Set<string>();
    for (const e of [...(v1?.before ?? []), ...(v1?.since ?? [])]) {
      for (const p of participants(e as AnyEntry)) {
        const proj = p as { anonymous: boolean; anonRef?: string };
        if (proj.anonymous && proj.anonRef) refs.add(proj.anonRef);
      }
    }
    expect(refs.size).toBe(1);
    const ref1 = [...refs][0];

    const v2 = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: otherCopy },
    );
    const transfer2 = findTransfer(v2 as View) as {
      from: { anonymous: boolean; anonRef?: string };
    };
    expect(transfer2.from.anonymous).toBe(true);
    // Same hidden member, DIFFERENT copy (salt) -> different anonRef (un-correlatable).
    expect(transfer2.from.anonRef).not.toBe(ref1);
  });

  test("a non-owned UNREACHABLE copy returns null (private/closed owner)", async () => {
    const t = convexTest(schema, modules);
    const { viewer, prevOwner, copy } = await seedCopy(t);
    // Hand the copy to prevOwner and make their profile private + the copy closed: unreachable.
    await t.run(async (ctx) => {
      await ctx.db.patch(copy, { ownerId: prevOwner });
    });
    await setVisibility(t, prevOwner, "private");
    void viewer;

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view).toBeNull();
  });

  test("a non-owned PUBLIC, OPEN copy is visible but omits owner-only fields", async () => {
    const t = convexTest(schema, modules);
    const { prevOwner, copy } = await seedCopy(t);
    // Hand the copy to prevOwner, mark it open, give it owner-only data, and make prevOwner public.
    await t.run(async (ctx) => {
      await ctx.db.patch(copy, {
        ownerId: prevOwner,
        availability: { forTrade: true, forSale: false, forLend: false },
        notes: "private owner note",
        acquisitionSource: "bought_used",
        acquisitionDate: 12345,
      });
    });
    await setVisibility(t, prevOwner, "public");

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view).not.toBeNull();
    expect(view?.viewerIsOwner).toBe(false);
    // Owner-only snapshot fields are omitted for a non-owner.
    expect(view?.snapshot.notes).toBeUndefined();
    expect(view?.snapshot.acquisitionSource).toBeUndefined();
    expect(view?.snapshot.acquisitionDate).toBeUndefined();
    // Adversarial: the private note value never appears anywhere in the payload.
    expect(JSON.stringify(view)).not.toContain("private owner note");

    // The owner, by contrast, sees those fields.
    await t.run(async (ctx) =>
      mkUser(ctx, "clerk_owner_check", "Owner Check", 1),
    );
    const ownerView = await t
      .withIdentity({ subject: "clerk_prev" })
      .query(api.library.getCopyInstanceView.getCopyInstanceView, {
        copyId: copy,
      });
    expect(ownerView?.viewerIsOwner).toBe(true);
    expect(ownerView?.snapshot.notes).toBe("private owner note");
    expect(ownerView?.snapshot.acquisitionSource).toBe("bought_used");
  });

  test("owner sees since/before split around acquiredByViewerAt; non-owner gets all in before", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, prevOwner, solver, copy } = await seedCopy(t);
    await setVisibility(t, prevOwner, "public");
    await setVisibility(t, solver, "public");

    // A completion by the viewer AFTER acquisition (now+100), and a loan that opened BEFORE it.
    await t.run(async (ctx) => {
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now + 200,
        endDate: now + 300,
        completionTimeMinutes: 100,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("loans", {
        aggregateId: "loan-1",
        copyId: "copy-1", // loans key by the copy's aggregateId
        lenderId: prevOwner,
        borrowerId: solver,
        status: "returned",
        openedAt: now + 10,
        closedAt: now + 20,
      });
    });

    const owned = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(owned?.viewerIsOwner).toBe(true);
    expect(owned?.acquiredByViewerAt).toBe(now + 100);
    // before: the loan (now+10) and the transfer (now+100 >= boundary goes to since).
    // The transfer occurredAt === boundary, so it lands in `since`.
    const sinceTypes = owned?.since.map((e) => e.type).sort();
    const beforeTypes = owned?.before.map((e) => e.type).sort();
    expect(beforeTypes).toEqual(["loan"]);
    expect(sinceTypes).toEqual(["completion", "transfer"]);

    // A NON-owner viewer sees everything in `before` and an empty `since`.
    const stranger = await t.run(async (ctx) =>
      mkUser(ctx, "clerk_stranger", "Stranger", now),
    );
    // Reassign ownership away from the viewer so the acting member is no longer the owner. Make the
    // copy OPEN so the public-owner reachability gate lets the non-owner view it.
    await t.run(async (ctx) => {
      await ctx.db.patch(copy, {
        ownerId: stranger,
        availability: { forTrade: true, forSale: false, forLend: false },
      });
    });
    await setVisibility(t, stranger, "public");
    const notOwner = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(notOwner?.viewerIsOwner).toBe(false);
    expect(notOwner?.since).toEqual([]);
    expect(notOwner?.before).toHaveLength(3); // transfer + completion + loan
  });
});

const DAY = 86_400_000;

describe("getCopyInstanceView rich detail", () => {
  test("difficulty + tags surface from the puzzle definition", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seedCopy(t);
    // Patch the puzzle def with difficulty/tags.
    await t.run(async (ctx) => {
      const c = await ctx.db.get(copy);
      await ctx.db.patch(c!.puzzleId, {
        difficulty: "hard",
        tags: ["landscape", "1000pc"],
      });
    });

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.snapshot.difficulty).toBe("hard");
    expect(view?.snapshot.tags).toEqual(["landscape", "1000pc"]);
  });

  test("tags default to [] when the puzzle has none", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seedCopy(t);
    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.snapshot.tags).toEqual([]);
    expect(view?.snapshot.difficulty).toBeUndefined();
  });

  test("stats: timesCompleted, fastestFinishMinutes, timesLentOut, yourAvgRating", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, solver, copy } = await seedCopy(t);
    await setVisibility(t, solver, "public");

    await t.run(async (ctx) => {
      // Viewer completion #1: 5-day solve, rating 4.
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now,
        endDate: now + 5 * DAY,
        rating: 4,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      // Viewer completion #2: 2-day solve (fastest), rating 5.
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now,
        endDate: now + 2 * DAY,
        rating: 5,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      // Another solver's completion: 10-day solve, unrated (no rating).
      await ctx.db.insert("completions", {
        userId: solver,
        ownedPuzzleId: copy,
        startDate: now,
        endDate: now + 10 * DAY,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      // In-progress (not counted toward timesCompleted).
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now,
        photos: [],
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      });
      // Two loans of the copy (keyed by aggregateId "copy-1").
      await ctx.db.insert("loans", {
        aggregateId: "loan-a",
        copyId: "copy-1",
        lenderId: viewer,
        borrowerId: solver,
        status: "returned",
        openedAt: now + 1,
        closedAt: now + 2,
      });
      await ctx.db.insert("loans", {
        aggregateId: "loan-b",
        copyId: "copy-1",
        lenderId: viewer,
        borrowerId: solver,
        status: "open",
        openedAt: now + 3,
      });
    });

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.stats.timesCompleted).toBe(3);
    // 2-day fastest solve, now reported in raw minutes (2 * 24 * 60).
    expect(view?.stats.fastestFinishMinutes).toBe(2 * 24 * 60);
    expect(view?.stats.timesLentOut).toBe(2);
    // Viewer's own ratings: 4 and 5 -> avg 4.5.
    expect(view?.stats.yourAvgRating).toBe(4.5);
  });

  test("stats with no completions: zeros and nulls", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seedCopy(t);
    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.stats.timesCompleted).toBe(0);
    expect(view?.stats.fastestFinishMinutes).toBeNull();
    expect(view?.stats.timesLentOut).toBe(0);
    expect(view?.stats.yourAvgRating).toBeNull();
  });

  test("community aggregation over the puzzle definition: count, avg, breakdown buckets", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, solver, copy } = await seedCopy(t);
    const puzzleId = await t.run(async (ctx) => {
      const c = await ctx.db.get(copy);
      return c!.puzzleId;
    });

    const otherUser = await t.run(async (ctx) =>
      mkUser(ctx, "clerk_other", "Other", now),
    );

    await t.run(async (ctx) => {
      // Rated completions across users of the PUZZLE DEFINITION (keyed by puzzleId):
      // ratings 5, 5, 3, 1 -> count 4, sum 14, avg 3.5; breakdown [5★,4★,3★,2★,1★] = [2,0,1,0,1].
      for (const [user, rating] of [
        [viewer, 5],
        [solver, 5],
        [otherUser, 3],
        [viewer, 1],
      ] as const) {
        await ctx.db.insert("completions", {
          userId: user,
          puzzleId,
          startDate: now,
          endDate: now + DAY,
          rating,
          photos: [],
          isCompleted: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      // An unrated puzzle-def completion must be excluded from count/avg/breakdown.
      await ctx.db.insert("completions", {
        userId: otherUser,
        puzzleId,
        startDate: now,
        endDate: now + DAY,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.community.count).toBe(4);
    expect(view?.community.rating).toBe(3.5);
    expect(view?.community.breakdown).toEqual([2, 0, 1, 0, 1]);
  });

  test("community is 0/empty when the puzzle has no rated completions", async () => {
    const t = convexTest(schema, modules);
    const { copy } = await seedCopy(t);
    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.community.count).toBe(0);
    expect(view?.community.rating).toBe(0);
    expect(view?.community.breakdown).toEqual([0, 0, 0, 0, 0]);
  });

  test("gallery resolves seeded ownedPuzzleImages to per-photo metadata", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, copy } = await seedCopy(t);

    const photoIds = await t.run(async (ctx) => {
      const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
      const fileId = await ctx.storage.store(blob);
      const first = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: viewer,
        fileId,
        title: "Box front",
        description: "The front of the box",
        tag: "box_front",
        takenAt: now + 10,
        createdAt: now,
        updatedAt: now,
      });
      // A second image with no title -> caption falls back to the tag.
      const blob2 = new Blob(["fake-image-2"], { type: "image/png" });
      const fileId2 = await ctx.storage.store(blob2);
      const second = await ctx.db.insert("ownedPuzzleImages", {
        ownedPuzzleId: copy,
        uploaderId: viewer,
        fileId: fileId2,
        tag: "pieces",
        takenAt: now + 5,
        createdAt: now,
        updatedAt: now,
      });
      return { first, second };
    });

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.gallery).toHaveLength(2);
    // Newest first by takenAt: the box_front (now+10) precedes the pieces (now+5).
    const first = view?.gallery[0];
    expect(first?.id).toBe(photoIds.first as string);
    expect(first?.url).toEqual(expect.any(String));
    expect(first?.caption).toBe("Box front");
    expect(first?.tag).toBe("box_front");
    expect(first?.description).toBe("The front of the box");
    expect(first?.uploaderName).toBe("Viewer");
    expect(first?.takenAt).toBe(now + 10);
    expect(first?.createdAt).toBe(now);

    const second = view?.gallery[1];
    expect(second?.id).toBe(photoIds.second as string);
    // caption falls back to the tag when no title; description null when absent.
    expect(second?.caption).toBe("pieces");
    expect(second?.tag).toBe("pieces");
    expect(second?.description).toBeNull();
    expect(second?.uploaderName).toBe("Viewer");
  });

  test("gallery moderation gating: approved/absent shown to all; rejected hidden; pending only to its uploader", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, prevOwner, copy } = await seedCopy(t);

    const ids = await t.run(async (ctx) => {
      const store = (label: string) =>
        ctx.storage.store(new Blob([label], { type: "image/png" }));
      const mkPhoto = async (
        uploaderId: Id<"users">,
        moderationStatus: "pending" | "approved" | "rejected" | undefined,
        takenAt: number,
      ) =>
        ctx.db.insert("ownedPuzzleImages", {
          ownedPuzzleId: copy,
          uploaderId,
          fileId: await store(`${moderationStatus ?? "legacy"}-${takenAt}`),
          ...(moderationStatus ? { moderationStatus } : {}),
          takenAt,
          createdAt: now,
          updatedAt: now,
        });

      return {
        approved: await mkPhoto(viewer, "approved", now + 50),
        legacy: await mkPhoto(viewer, undefined, now + 40),
        rejected: await mkPhoto(viewer, "rejected", now + 30),
        viewerPending: await mkPhoto(viewer, "pending", now + 20),
        otherPending: await mkPhoto(prevOwner, "pending", now + 10),
      };
    });

    // The OWNER/uploader (viewer) sees: approved + legacy(absent) + their own pending. NOT the
    // rejected one, NOT the other member's pending one.
    const ownerView = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    const ownerIds = (ownerView?.gallery ?? []).map((p) => p.id);
    expect(ownerIds).toEqual([
      ids.approved as string,
      ids.legacy as string,
      ids.viewerPending as string,
    ]);
    // The viewer's own pending photo carries the badge; approved/legacy read "approved".
    const byId = new Map(
      (ownerView?.gallery ?? []).map((p) => [p.id, p.moderationStatus]),
    );
    expect(byId.get(ids.viewerPending as string)).toBe("pending");
    expect(byId.get(ids.approved as string)).toBe("approved");
    expect(byId.get(ids.legacy as string)).toBe("approved");

    // A DIFFERENT viewer (who uploaded none of these) sees ONLY approved + legacy — no pending
    // (none are theirs), no rejected. Gating keys on the UPLOADER, not the copy owner, so we query
    // as a fresh identity rather than reassigning ownership. The copy must be OPEN so the
    // public-owner reachability gate lets this non-owner reach it.
    await t.run(async (ctx) => {
      await mkUser(ctx, "clerk_stranger2", "Stranger2", now);
      await ctx.db.patch(copy, {
        availability: { forTrade: true, forSale: false, forLend: false },
      });
    });
    const strangerView = await t
      .withIdentity({ subject: "clerk_stranger2" })
      .query(api.library.getCopyInstanceView.getCopyInstanceView, {
        copyId: copy,
      });
    const strangerIds = (strangerView?.gallery ?? []).map((p) => p.id);
    expect(strangerIds).toEqual([ids.approved as string, ids.legacy as string]);
    // Adversarial: the rejected and the foreign-pending photos never appear.
    expect(strangerIds).not.toContain(ids.rejected as string);
    expect(strangerIds).not.toContain(ids.viewerPending as string);
    expect(strangerIds).not.toContain(ids.otherPending as string);
  });

  test("grouped completion entries carry rating, note and isYou", async () => {
    const t = convexTest(schema, modules);
    const { now, viewer, solver, copy } = await seedCopy(t);
    await setVisibility(t, solver, "public");

    await t.run(async (ctx) => {
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now,
        endDate: now + 3 * DAY,
        rating: 5,
        review: "Loved it",
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("completions", {
        userId: solver,
        ownedPuzzleId: copy,
        startDate: now,
        endDate: now + 7 * DAY,
        photos: [],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
      // In-progress completion is excluded from the grouped completions list.
      await ctx.db.insert("completions", {
        userId: viewer,
        ownedPuzzleId: copy,
        startDate: now,
        photos: [],
        isCompleted: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const view = await asViewer(t).query(
      api.library.getCopyInstanceView.getCopyInstanceView,
      { copyId: copy },
    );
    expect(view?.completions).toHaveLength(2);
    // Newest first: solver's (now+7d) precedes viewer's (now+3d).
    const solverEntry = view?.completions[0];
    const viewerEntry = view?.completions[1];
    expect(solverEntry?.isYou).toBe(false);
    expect(solverEntry?.finishMinutes).toBe(7 * 24 * 60);
    expect(solverEntry?.rating).toBeNull();
    expect(solverEntry?.note).toBeNull();

    expect(viewerEntry?.isYou).toBe(true);
    expect(viewerEntry?.finishMinutes).toBe(3 * 24 * 60);
    expect(viewerEntry?.rating).toBe(5);
    expect(viewerEntry?.note).toBe("Loved it");
  });
});
