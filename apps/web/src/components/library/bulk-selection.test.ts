import { describe, expect, it } from "vitest";
import {
  BULK_OFFERS_BATCH,
  canSelectCopy,
  chunk,
  OFFER_CHANGES,
  planCircleShare,
  planCollectionAdd,
  planOfferAction,
  runWithConcurrency,
  selectedInView,
  shareInBatches,
  toggleSelection,
  undoChanges,
  type BulkCopy,
} from "./bulk-selection";

// My Puzzles' selection mode: which copies may be picked, what a bulk offer action sends (and
// leaves alone), how it is undone, and how a collection add is spread over the selected copies.

const CLOSED = { forTrade: false, forLend: false, forSale: false };

const copy = (id: string, extra: Partial<BulkCopy> = {}): BulkCopy => ({
  _id: id,
  aggregateId: `agg_${id}`,
  availability: CLOSED,
  visibility: "visible",
  ...extra,
});

describe("canSelectCopy", () => {
  it("lets the member pick their own copies and housemates' copies they may manage", () => {
    expect(canSelectCopy(copy("a"), undefined)).toBe(true);
    expect(canSelectCopy(copy("a"), { viewerAccess: "manage" })).toBe(true);
  });

  it("never offers a view-only housemate copy or a legacy row without a domain id", () => {
    expect(canSelectCopy(copy("a"), { viewerAccess: "view" })).toBe(false);
    expect(
      canSelectCopy(copy("a", { aggregateId: undefined }), undefined),
    ).toBe(false);
  });
});

describe("selection", () => {
  it("toggles one copy in and out without touching the others", () => {
    const one = toggleSelection(new Set(["a"]), "b");
    expect([...one]).toEqual(["a", "b"]);
    expect([...toggleSelection(one, "a")]).toEqual(["b"]);
  });

  it("acts only on what is selected AND on screen, in the list's order", () => {
    // "c" was selected before a filter hid it: it stays selected but is not acted on.
    const selected = new Set(["c", "b", "a"]);
    expect(selectedInView(selected, ["a", "b", "d"])).toEqual(["a", "b"]);
  });
});

describe("planOfferAction", () => {
  it("sends only the offer it sets, never a visibility or a price", () => {
    expect(OFFER_CHANGES.offerSwap).toEqual({ forTrade: true });
    expect(OFFER_CHANGES.offerLend).toEqual({ forLend: true });
    expect(OFFER_CHANGES.withdraw).toEqual(CLOSED);
    for (const change of Object.values(OFFER_CHANGES)) {
      expect(Object.keys(change).every((key) => key.startsWith("for"))).toBe(
        true,
      );
    }
  });

  it("sends the copies the action changes, with what they had before", () => {
    const plan = planOfferAction(
      [
        copy("a"),
        copy("b", { availability: { ...CLOSED, forTrade: true } }),
        copy("c", { availability: { ...CLOSED, forLend: true } }),
      ],
      "offerSwap",
    );
    expect(plan.send).toEqual([
      { copyId: "agg_a", previous: CLOSED, wasPrivate: false },
      {
        copyId: "agg_c",
        previous: { ...CLOSED, forLend: true },
        wasPrivate: false,
      },
    ]);
    // "b" is already offered for swap: counted, not sent.
    expect(plan.unchanged).toBe(1);
  });

  it("withdraws from every copy with any offer and counts the ones with none", () => {
    const plan = planOfferAction(
      [copy("a", { availability: { ...CLOSED, forSale: true } }), copy("b")],
      "withdraw",
    );
    expect(plan.send.map((s) => s.copyId)).toEqual(["agg_a"]);
    expect(plan.unchanged).toBe(1);
  });

  it("marks the private copies an offer makes visible", () => {
    const plan = planOfferAction(
      [copy("a", { visibility: "private" }), copy("b")],
      "offerSwap",
    );
    expect(plan.send.map((s) => s.wasPrivate)).toEqual([true, false]);
  });

  it("skips copies without a domain id instead of sending an unknown id", () => {
    const plan = planOfferAction(
      [copy("a", { aggregateId: undefined }), copy("b")],
      "offerSwap",
    );
    expect(plan.send.map((s) => s.copyId)).toEqual(["agg_b"]);
  });
});

describe("chunk", () => {
  it("splits a large selection into calls the server accepts", () => {
    const ids = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunk(ids, BULK_OFFERS_BATCH);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
    expect(chunk([], BULK_OFFERS_BATCH)).toEqual([]);
  });
});

describe("undoChanges", () => {
  it("turns off again only the offer that was turned on", () => {
    expect(
      undoChanges("offerSwap", [
        { copyId: "a", previous: CLOSED },
        { copyId: "b", previous: { ...CLOSED, forLend: true } },
      ]),
    ).toEqual([{ copyIds: ["a", "b"], change: { forTrade: false } }]);
  });

  it("puts back each copy's own offers after a withdraw, grouped by what they were", () => {
    const tradeOnly = { ...CLOSED, forTrade: true };
    const all = { forTrade: true, forLend: true, forSale: true };
    expect(
      undoChanges("withdraw", [
        { copyId: "a", previous: tradeOnly },
        { copyId: "b", previous: all },
        { copyId: "c", previous: tradeOnly },
      ]),
    ).toEqual([
      { copyIds: ["a", "c"], change: tradeOnly },
      { copyIds: ["b"], change: all },
    ]);
  });

  it("has nothing to undo when nothing changed", () => {
    expect(undoChanges("offerLend", [])).toEqual([]);
  });
});

describe("planCollectionAdd", () => {
  it("adds only the member's own copies: housemates' copies stay out of personal collections", () => {
    const plan = planCollectionAdd(
      [copy("a"), copy("b"), copy("c", { aggregateId: undefined })],
      (copyDocId) => copyDocId === "b",
    );
    expect(plan.copyIds).toEqual(["agg_a"]);
    expect(plan.housemates).toBe(1);
  });
});

describe("planCircleShare", () => {
  const OFFERED = { ...CLOSED, forLend: true };

  it("sends only the member's own copies: only a copy's owner may share it", () => {
    const plan = planCircleShare(
      [
        copy("a", { availability: OFFERED }),
        copy("b", { availability: OFFERED }),
        copy("c", { aggregateId: undefined, availability: OFFERED }),
      ],
      (copyDocId) => copyDocId === "b",
    );
    expect(plan.copyIds).toEqual(["agg_a"]);
    expect(plan.housemates).toBe(1);
  });

  it("names the own copies circle members won't see once shared", () => {
    const plan = planCircleShare(
      [
        copy("offered", { availability: OFFERED }),
        copy("closed"),
        copy("private", { visibility: "private" }),
        copy("theirs"),
      ],
      (copyDocId) => copyDocId === "theirs",
    );
    expect(plan.copyIds).toEqual(["agg_offered", "agg_closed", "agg_private"]);
    expect(plan.hidden).toEqual(["agg_closed", "agg_private"]);
  });
});

describe("shareInBatches", () => {
  class Gone extends Error {}
  const isGone = (error: unknown) => error instanceof Gone;
  const ids = (count: number) =>
    Array.from({ length: count }, (_, i) => `c${i}`);

  it("sends at most one batch's worth at a time and adds up the answers", async () => {
    const sizes: number[] = [];
    const result = await shareInBatches(
      ids(250),
      async (batch) => {
        sizes.push(batch.length);
        return { shared: batch.length - 1, alreadyShared: 1 };
      },
      isGone,
    );
    expect(sizes).toEqual([100, 100, 50]);
    expect(result).toMatchObject({
      shared: 247,
      alreadyShared: 3,
      gone: [],
      failed: [],
    });
    expect(result.done).toHaveLength(250);
  });

  it("narrows an all-or-nothing refusal down to the copies that are gone, and shares the rest", async () => {
    const lost = new Set(["c3", "c7"]);
    const shared: string[] = [];
    const sizes: number[] = [];
    const result = await shareInBatches(
      ids(8),
      async (batch) => {
        sizes.push(batch.length);
        if (batch.some((id) => lost.has(id))) throw new Gone();
        shared.push(...batch);
        return { shared: batch.length, alreadyShared: 0 };
      },
      isGone,
    );
    expect(result.gone.sort()).toEqual(["c3", "c7"]);
    expect(result.failed).toEqual([]);
    expect(result.shared).toBe(6);
    expect(shared.sort()).toEqual(["c0", "c1", "c2", "c4", "c5", "c6"]);
    // Far fewer calls than one per copy.
    expect(sizes.length).toBeLessThan(2 * 8);
  });

  it("counts a batch refused for any other reason as failed and goes on with the next", async () => {
    const refusal = new Error("offline");
    let call = 0;
    const result = await shareInBatches(
      ids(120),
      async (batch) => {
        call += 1;
        if (call === 1) throw refusal;
        return { shared: batch.length, alreadyShared: 0 };
      },
      isGone,
    );
    expect(call).toBe(2);
    expect(result.failed).toHaveLength(100);
    expect(result.shared).toBe(20);
    expect(result.refusal).toBe(refusal);
  });

  it("sends nothing for an empty plan", async () => {
    const send = async () => ({ shared: 0, alreadyShared: 0 });
    expect(await shareInBatches([], send, isGone)).toEqual({
      shared: 0,
      alreadyShared: 0,
      done: [],
      gone: [],
      failed: [],
    });
  });
});

describe("runWithConcurrency", () => {
  it("runs every task, never more than the limit at once, and reports failures", async () => {
    let running = 0;
    let peak = 0;
    const result = await runWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        if (n % 3 === 0) throw new Error("refused");
      },
    );
    expect(peak).toBe(3);
    expect(result.succeeded.sort()).toEqual([1, 2, 4, 5, 7]);
    expect(result.failed.sort()).toEqual([3, 6]);
  });

  it("does nothing for an empty list", async () => {
    expect(await runWithConcurrency([], 4, async () => {})).toEqual({
      succeeded: [],
      failed: [],
    });
  });
});
