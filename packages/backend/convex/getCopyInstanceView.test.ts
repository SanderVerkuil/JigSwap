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
    // Reassign ownership away from the viewer so the acting member is no longer the owner.
    await t.run(async (ctx) => {
      await ctx.db.patch(copy, { ownerId: stranger });
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
