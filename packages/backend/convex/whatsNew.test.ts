import type { WhatsNewManifestEntry } from "@jigswap/contracts";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// W1 ships no real entries, so the backend's manifest accessor is swapped for fixtures.
const fixture = vi.hoisted(() => ({
  manifest: [] as WhatsNewManifestEntry[],
}));
vi.mock("./whatsNew/manifest", () => ({
  whatsNewManifest: () => fixture.manifest,
}));

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

// Newest first, like the generated manifest.
const NEW = {
  id: "new",
  publishedAt: day("2026-10-20"),
  highlight: false,
  notify: true,
};
const MID = {
  id: "mid",
  publishedAt: day("2026-10-10"),
  highlight: true,
  notify: false,
  tour: "mid-tour",
};
const OLD = {
  id: "old",
  publishedAt: day("2026-09-01"),
  highlight: true,
  notify: true,
};

beforeEach(() => {
  fixture.manifest = [NEW, MID, OLD];
});

type T = TestConvex<typeof schema>;

// Ann joined between OLD and MID; Bob joined after every entry.
const seed = async (t: T) =>
  t.run(async (ctx) => {
    const mkUser = (clerkId: string, createdAt: number) =>
      ctx.db.insert("users", {
        clerkId,
        email: `${clerkId}@example.com`,
        isActive: true,
        createdAt,
        updatedAt: createdAt,
      });
    return {
      ann: await mkUser("clerk_ann", day("2026-10-01")),
      bob: await mkUser("clerk_bob", day("2026-11-01")),
    };
  });

const as = (t: T, who: "ann" | "bob") =>
  t.withIdentity({ subject: `clerk_${who}` });

const stateOf = (t: T, who: "ann" | "bob") =>
  as(t, who).query(api.whatsNew.getWhatsNewState.getWhatsNewState, {});

const seenRows = (t: T, memberId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("whatsNewReadStates")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect(),
  );

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const codeOf = async (
  promise: Promise<unknown>,
): Promise<string | undefined> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<unknown>).data;
    return (typeof data === "string" ? JSON.parse(data) : data)?.code;
  }
  throw new Error("expected the call to reject");
};

describe("whatsNew: authentication", () => {
  test("every function rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.query(api.whatsNew.getWhatsNewState.getWhatsNewState, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.whatsNew.markWhatsNewSeen.markWhatsNewSeen, {
        ids: ["new"],
      }),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.whatsNew.markAllSeen.markAllSeen, {}),
    ).rejects.toThrow(/Unauthenticated/);
    await expect(
      t.mutation(api.whatsNew.recordTourProgress.recordTourProgress, {
        tourId: "mid-tour",
        status: "completed",
      }),
    ).rejects.toThrow(/Unauthenticated/);
    expect(
      await t.run((ctx) => ctx.db.query("whatsNewReadStates").collect()),
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("whatsNewTourProgress").collect()),
    ).toEqual([]);
  });
});

describe("whatsNew: unread", () => {
  test("entries published before the account was created are never unread", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await stateOf(t, "ann")).toEqual({
      unreadIds: ["new", "mid"],
      tours: [],
    });
    // Bob joined after every entry: nothing is ever new for him.
    expect((await stateOf(t, "bob")).unreadIds).toEqual([]);
  });

  test("an entry stays unread until it is marked seen", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await as(t, "ann").mutation(
      api.whatsNew.markWhatsNewSeen.markWhatsNewSeen,
      { ids: ["mid"] },
    );
    expect((await stateOf(t, "ann")).unreadIds).toEqual(["new"]);
  });

  test("markAllSeen clears every unread entry", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    expect((await stateOf(t, "ann")).unreadIds).toEqual([]);
    // Only entries that were unread are stored; the pre-account OLD is read by definition.
    expect((await seenRows(t, ann))[0].seenEntryIds).toEqual(["new", "mid"]);
  });

  test("a newly published entry is unread after markAllSeen", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    const NEWER = { ...NEW, id: "newer", publishedAt: day("2026-10-25") };
    fixture.manifest = [NEWER, NEW, MID, OLD];
    expect((await stateOf(t, "ann")).unreadIds).toEqual(["newer"]);
  });

  test("marking is idempotent: one row, no duplicate ids", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    const mark = (ids: string[]) =>
      as(t, "ann").mutation(api.whatsNew.markWhatsNewSeen.markWhatsNewSeen, {
        ids,
      });
    await mark(["mid", "mid"]);
    await mark(["mid"]);
    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    await mark(["new", "mid"]);
    const rows = await seenRows(t, ann);
    expect(rows).toHaveLength(1);
    expect(rows[0].seenEntryIds).toEqual(["new", "mid"]);
  });

  test("unknown and pre-account ids are ignored and never stored", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    await as(t, "ann").mutation(
      api.whatsNew.markWhatsNewSeen.markWhatsNewSeen,
      { ids: ["nope", "old"] },
    );
    expect(await seenRows(t, ann)).toEqual([]);
    expect((await stateOf(t, "ann")).unreadIds).toEqual(["new", "mid"]);
  });

  test("a batch over the cap is rejected", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    expect(
      await codeOf(
        as(t, "ann").mutation(api.whatsNew.markWhatsNewSeen.markWhatsNewSeen, {
          ids: Array.from({ length: 51 }, () => "new"),
        }),
      ),
    ).toBe("too_many_ids");
    expect(await seenRows(t, ann)).toEqual([]);
  });

  test("ids that left the manifest are pruned on the next write", async () => {
    const t = convexTest(schema, modules);
    const { ann } = await seed(t);
    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    fixture.manifest = [NEW, OLD]; // MID removed
    await as(t, "ann").mutation(
      api.whatsNew.markWhatsNewSeen.markWhatsNewSeen,
      { ids: ["new"] },
    );
    expect((await seenRows(t, ann))[0].seenEntryIds).toEqual(["new"]);
  });

  test("a member's writes never touch another member's state", async () => {
    const t = convexTest(schema, modules);
    const { ann, bob } = await seed(t);
    // Bob marks Ann-relevant ids: he has nothing unread, so nothing is stored for anyone.
    await as(t, "bob").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    await as(t, "bob").mutation(
      api.whatsNew.markWhatsNewSeen.markWhatsNewSeen,
      { ids: ["new", "mid"] },
    );
    expect((await stateOf(t, "ann")).unreadIds).toEqual(["new", "mid"]);
    expect(
      await t.run((ctx) => ctx.db.query("whatsNewReadStates").collect()),
    ).toEqual([]);
    expect(await seenRows(t, bob)).toEqual([]);

    await as(t, "ann").mutation(api.whatsNew.markAllSeen.markAllSeen, {});
    const rows = await t.run((ctx) =>
      ctx.db.query("whatsNewReadStates").collect(),
    );
    expect(rows.map((row) => row.memberId)).toEqual([ann]);
  });
});

describe("whatsNew: tour progress", () => {
  const record = (
    t: T,
    who: "ann" | "bob",
    args: {
      tourId: string;
      status: "in_progress" | "completed" | "dismissed";
      step?: number;
    },
  ) =>
    as(t, who).mutation(
      api.whatsNew.recordTourProgress.recordTourProgress,
      args,
    );

  test("records, resumes and completes a tour", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await record(t, "ann", {
      tourId: "mid-tour",
      status: "in_progress",
      step: 0,
    });
    await record(t, "ann", {
      tourId: "mid-tour",
      status: "in_progress",
      step: 2,
    });
    expect((await stateOf(t, "ann")).tours).toEqual([
      {
        tourId: "mid-tour",
        status: "in_progress",
        step: 2,
        updatedAt: expect.any(Number),
      },
    ]);

    await record(t, "ann", { tourId: "mid-tour", status: "completed" });
    expect((await stateOf(t, "ann")).tours).toEqual([
      {
        tourId: "mid-tour",
        status: "completed",
        updatedAt: expect.any(Number),
      },
    ]);
    const rows = await t.run((ctx) =>
      ctx.db.query("whatsNewTourProgress").collect(),
    );
    expect(rows).toHaveLength(1);
  });

  test("records a dismissal with the step it stopped at", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await record(t, "ann", {
      tourId: "mid-tour",
      status: "dismissed",
      step: 1,
    });
    expect((await stateOf(t, "ann")).tours).toMatchObject([
      { tourId: "mid-tour", status: "dismissed", step: 1 },
    ]);
  });

  test("keeps tour progress per member", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await record(t, "ann", { tourId: "mid-tour", status: "completed" });
    expect((await stateOf(t, "bob")).tours).toEqual([]);
  });

  test("rejects a tour id that no manifest entry references", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await codeOf(record(t, "ann", { tourId: "nope", status: "completed" })),
    ).toBe("unknown_tour");
  });

  test.each([
    ["a negative step", -1],
    ["a fractional step", 1.5],
    ["a step past the cap", 50],
    ["a missing step while in progress", undefined],
  ])("rejects %s", async (_label, step) => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(
      await codeOf(
        record(t, "ann", { tourId: "mid-tour", status: "in_progress", step }),
      ),
    ).toBe("invalid_step");
    expect(
      await t.run((ctx) => ctx.db.query("whatsNewTourProgress").collect()),
    ).toEqual([]);
  });
});
