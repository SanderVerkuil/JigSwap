import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// The Exchanges page's reads (PERF-B13): everything still in play in one bounded read, finished
// exchanges a page at a time, a deep link to one exchange whatever page it is on, and the phone
// chrome's waiting-requests count without a join per exchange.

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;
type Status = Doc<"exchanges">["status"];

const BASE = 1_700_000_000_000;

interface World {
  alice: Id<"users">;
  bob: Id<"users">;
  eve: Id<"users">;
  alicesCopy: Id<"ownedPuzzles">;
  bobsCopy: Id<"ownedPuzzles">;
}

const seed = (t: T): Promise<World> =>
  t.run(async (ctx) => {
    const user = (name: string) =>
      ctx.db.insert("users", {
        clerkId: `clerk_${name}`,
        email: `${name}@example.com`,
        name,
        isActive: true,
        createdAt: BASE,
        updatedAt: BASE,
      });
    const alice = await user("alice");
    const bob = await user("bob");
    const eve = await user("eve");
    const puzzle = await ctx.db.insert("puzzles", {
      title: "Harbour Lights",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: BASE,
      updatedAt: BASE,
    });
    const copy = (ownerId: Id<"users">) =>
      ctx.db.insert("ownedPuzzles", {
        puzzleId: puzzle,
        ownerId,
        condition: "good",
        availability: { forTrade: true, forSale: false, forLend: false },
        createdAt: BASE,
        updatedAt: BASE,
      });
    return {
      alice,
      bob,
      eve,
      alicesCopy: await copy(alice),
      bobsCopy: await copy(bob),
    };
  });

// `asInitiator`: Alice asked (outgoing); otherwise Bob asked for Alice's copy (incoming).
const addExchange = (
  t: T,
  w: World,
  id: string,
  status: Status,
  {
    asInitiator = true,
    createdAt = BASE,
    updatedAt = createdAt,
  }: { asInitiator?: boolean; createdAt?: number; updatedAt?: number } = {},
) =>
  t.run((ctx) =>
    ctx.db.insert("exchanges", {
      aggregateId: id,
      initiatorId: asInitiator ? w.alice : w.bob,
      recipientId: asInitiator ? w.bob : w.alice,
      type: "loan",
      requestedPuzzleId: asInitiator ? w.bobsCopy : w.alicesCopy,
      status,
      createdAt,
      updatedAt,
    }),
  );

const as = (t: T, who: string) => t.withIdentity({ subject: `clerk_${who}` });

const live = (t: T, who = "alice") =>
  as(t, who).query(api.exchange.listMyLiveExchanges.listMyLiveExchanges, {});

const history = (
  t: T,
  args: {
    direction?: "all" | "incoming" | "outgoing";
    status?: "completed" | "rejected" | "cancelled";
    numItems?: number;
    cursor?: string | null;
  } = {},
  who = "alice",
) =>
  as(t, who).query(api.exchange.listMyExchangeHistory.listMyExchangeHistory, {
    ...(args.direction ? { direction: args.direction } : {}),
    ...(args.status ? { status: args.status } : {}),
    paginationOpts: {
      numItems: args.numItems ?? 50,
      cursor: args.cursor ?? null,
    },
  });

let t: T;
let w: World;

beforeEach(async () => {
  t = convexTest(schema, modules);
  w = await seed(t);
});

describe("exchange.myLive", () => {
  test("anonymous or unknown callers get nothing", async () => {
    expect(
      await t.query(api.exchange.listMyLiveExchanges.listMyLiveExchanges, {}),
    ).toEqual([]);
  });

  test("everything in play, both roles tagged, most recent activity first; nothing finished", async () => {
    await addExchange(t, w, "open-old", "proposed", {
      asInitiator: false,
      updatedAt: BASE + 1,
    });
    await addExchange(t, w, "accepted", "accepted", { updatedAt: BASE + 3 });
    await addExchange(t, w, "disputed", "disputed", {
      asInitiator: false,
      updatedAt: BASE + 2,
    });
    await addExchange(t, w, "done", "completed", { updatedAt: BASE + 9 });
    await addExchange(t, w, "no", "rejected");
    await addExchange(t, w, "off", "cancelled");

    const rows = await live(t);
    expect(rows.map((row) => [row.aggregateId, row.userRole])).toEqual([
      ["accepted", "requester"],
      ["disputed", "owner"],
      ["open-old", "owner"],
    ]);
  });

  test("an old open exchange is listed however many finished ones came after", async () => {
    await addExchange(t, w, "old-open", "proposed", { createdAt: BASE - 999 });
    await t.run(async (ctx) => {
      for (let i = 0; i < 600; i++) {
        await ctx.db.insert("exchanges", {
          aggregateId: `done-${i}`,
          initiatorId: w.alice,
          recipientId: w.bob,
          type: "loan",
          requestedPuzzleId: w.bobsCopy,
          status: "completed",
          createdAt: BASE + i,
          updatedAt: BASE + i,
        });
      }
    });
    expect((await live(t)).map((row) => row.aggregateId)).toEqual(["old-open"]);
  });

  test("a stranger's exchanges stay out", async () => {
    await addExchange(t, w, "x", "proposed");
    expect(await live(t, "eve")).toEqual([]);
  });
});

describe("exchange.myHistory", () => {
  test("anonymous callers get an empty, finished page", async () => {
    expect(
      await t.query(api.exchange.listMyExchangeHistory.listMyExchangeHistory, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).toEqual({ page: [], isDone: true, continueCursor: "" });
  });

  test("finished exchanges only, both roles, by most recent activity", async () => {
    await addExchange(t, w, "open", "proposed", { updatedAt: BASE + 50 });
    await addExchange(t, w, "done-out", "completed", {
      createdAt: BASE,
      updatedAt: BASE + 3,
    });
    await addExchange(t, w, "done-in", "rejected", {
      asInitiator: false,
      createdAt: BASE + 10,
      updatedAt: BASE + 2,
    });
    await addExchange(t, w, "off", "cancelled", {
      createdAt: BASE + 5,
      updatedAt: BASE + 4,
    });

    const { page, isDone } = await history(t);
    expect(isDone).toBe(true);
    expect(page.map((row) => [row.aggregateId, row.userRole])).toEqual([
      ["off", "requester"],
      ["done-out", "requester"],
      ["done-in", "owner"],
    ]);
    // A full summary row, as the list renders it.
    expect(page[0].requestedPuzzle?.title).toBe("Harbour Lights");
  });

  test("direction and status narrow on the server", async () => {
    await addExchange(t, w, "out", "completed", { updatedAt: BASE + 2 });
    await addExchange(t, w, "in", "completed", {
      asInitiator: false,
      updatedAt: BASE + 1,
    });
    await addExchange(t, w, "off", "cancelled", { updatedAt: BASE });

    const ids = async (args: Parameters<typeof history>[1]) =>
      (await history(t, args)).page.map((row) => row.aggregateId);
    expect(await ids({ direction: "incoming" })).toEqual(["in"]);
    expect(await ids({ direction: "outgoing" })).toEqual(["out", "off"]);
    expect(await ids({ status: "cancelled" })).toEqual(["off"]);
    expect(await ids({ direction: "incoming", status: "cancelled" })).toEqual(
      [],
    );
  });

  test("pages through a long history without repeats or holes", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < 7; i++) {
        await ctx.db.insert("exchanges", {
          aggregateId: `x-${i}`,
          initiatorId: i % 2 === 0 ? w.alice : w.bob,
          recipientId: i % 2 === 0 ? w.bob : w.alice,
          type: "loan",
          requestedPuzzleId: i % 2 === 0 ? w.bobsCopy : w.alicesCopy,
          status: "completed",
          createdAt: BASE + i,
          updatedAt: BASE + i,
        });
      }
    });
    const seen: (string | undefined)[] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: Awaited<ReturnType<typeof history>> = await history(t, {
        numItems: 3,
        cursor,
      });
      seen.push(...result.page.map((row) => row.aggregateId));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual(["x-6", "x-5", "x-4", "x-3", "x-2", "x-1", "x-0"]);
  });

  test("clamps the page size", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("exchanges", {
          initiatorId: w.alice,
          recipientId: w.bob,
          type: "loan",
          requestedPuzzleId: w.bobsCopy,
          status: "completed",
          createdAt: BASE + i,
          updatedAt: BASE + i,
        });
      }
    });
    expect(
      (await history(t, { numItems: 1000 })).page.length,
    ).toBeLessThanOrEqual(50);
  });

  test("a stranger reads nothing", async () => {
    await addExchange(t, w, "x", "completed");
    expect((await history(t, {}, "eve")).page).toEqual([]);
  });
});

describe("exchange.myExchange", () => {
  const one = (exchange: string, who = "alice") =>
    as(t, who).query(api.exchange.getMyExchangeSummary.getMyExchangeSummary, {
      exchange,
    });

  test("finds a party's exchange by its domain id or its row id, with their role", async () => {
    const rowId = await addExchange(t, w, "old-done", "completed", {
      asInitiator: false,
    });
    expect((await one("old-done"))?.userRole).toBe("owner");
    expect((await one(rowId))?.aggregateId).toBe("old-done");
    expect((await one("old-done", "bob"))?.userRole).toBe("requester");
  });

  test("anyone else, and an unknown id, get null", async () => {
    const rowId = await addExchange(t, w, "x", "completed");
    expect(await one("x", "eve")).toBeNull();
    expect(await one(rowId, "eve")).toBeNull();
    expect(await one("no-such-exchange")).toBeNull();
    expect(
      await t.query(api.exchange.getMyExchangeSummary.getMyExchangeSummary, {
        exchange: "x",
      }),
    ).toBeNull();
  });
});

describe("exchange.myPendingRequestCount", () => {
  const count = (who = "alice") =>
    as(t, who).query(
      api.exchange.getMyPendingRequestCount.getMyPendingRequestCount,
      {},
    );

  test("counts requests the member received that wait on them, nothing else", async () => {
    await addExchange(t, w, "in-1", "proposed", { asInitiator: false });
    await addExchange(t, w, "in-2", "proposed", { asInitiator: false });
    await addExchange(t, w, "out", "proposed");
    await addExchange(t, w, "in-accepted", "accepted", { asInitiator: false });
    expect(await count()).toBe(2);
    expect(await count("bob")).toBe(1);
    expect(await count("eve")).toBe(0);
  });

  test("anonymous callers get zero", async () => {
    expect(
      await t.query(
        api.exchange.getMyPendingRequestCount.getMyPendingRequestCount,
        {},
      ),
    ).toBe(0);
  });
});
