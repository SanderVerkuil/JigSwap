import { describe, expect, it } from "vitest";
import {
  BULK_OFFERS_BATCH,
  canSelectCopy,
  chunk,
  OFFER_CHANGES,
  planCollectionAdd,
  planOfferAction,
  runWithConcurrency,
  selectedInView,
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
