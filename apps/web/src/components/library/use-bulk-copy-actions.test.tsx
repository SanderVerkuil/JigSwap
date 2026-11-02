// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import type { BulkCopy } from "./bulk-selection";
import { useBulkCopyActions } from "./use-bulk-copy-actions";

// My Puzzles' bulk actions: offers go out in server-sized calls with offers only (never a
// visibility), one toast sums up what happened, including what the server skipped, and Undo puts
// back only what changed; Add to collection sends the member's own copies and sums up the same way.

type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
};
type OffersResult = {
  updated: number;
  unchanged: number;
  skipped: { copyId: string; reason: "notAllowed" | "onLoan" | "reserved" }[];
};

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastError: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastInfo: vi.fn<(message: string, options?: ToastOptions) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

const UPDATE_OFFERS = getFunctionName(gateway.library.updateOffers);
const ADD_TO_COLLECTION = getFunctionName(gateway.collections.addOwnedPuzzle);
const SHARE_COPIES = getFunctionName(gateway.sharing.shareCopiesToCircle);
const CLOSED = { forTrade: false, forLend: false, forSale: false };

const copy = (id: string, extra: Partial<BulkCopy> = {}): BulkCopy => ({
  _id: id,
  aggregateId: `agg_${id}`,
  availability: CLOSED,
  visibility: "visible",
  ...extra,
});

// Answers updateOffers as the server would when every sent copy changes, minus `skip`.
const serverOffers =
  (skip: OffersResult["skipped"] = []) =>
  async (name: string, args: unknown): Promise<unknown> => {
    if (name !== UPDATE_OFFERS) return null;
    const { copyIds } = args as { copyIds: string[] };
    const skipped = skip.filter((s) => copyIds.includes(s.copyId));
    return {
      updated: copyIds.length - skipped.length,
      unchanged: 0,
      skipped,
    } satisfies OffersResult;
  };

const offerCalls = () =>
  mocks.mutation.mock.calls
    .filter(([name]) => name === UPDATE_OFFERS)
    .map(([, args]) => args as Record<string, unknown>);

const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {children}
  </IntlProvider>
);

const renderActions = ({ housemates = [] as string[] } = {}) =>
  renderHook(
    () =>
      useBulkCopyActions({
        isHousemateCopy: (id) => housemates.includes(id),
      }),
    { wrapper },
  );

const lastToast = (fn: typeof mocks.toastSuccess) => {
  const call = fn.mock.calls.at(-1);
  if (!call) throw new Error("no toast");
  return { message: call[0], options: call[1] ?? {} };
};

beforeEach(() => {
  mocks.mutation.mockReset().mockImplementation(serverOffers());
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.toastInfo.mockReset();
});
afterEach(cleanup);

describe("bulk offers", () => {
  it("offers the copies that change, with the offer only, and sums up what stayed as it was", async () => {
    mocks.mutation.mockImplementation(
      serverOffers([{ copyId: "agg_c", reason: "onLoan" }]),
    );
    const { result } = renderActions();
    await act(() =>
      result.current.offer("offerSwap", [
        copy("a", { visibility: "private" }),
        copy("b", { availability: { ...CLOSED, forTrade: true } }),
        copy("c"),
        copy("d", { availability: { ...CLOSED, forLend: true } }),
      ]),
    );

    expect(offerCalls()).toEqual([
      { copyIds: ["agg_a", "agg_c", "agg_d"], forTrade: true },
    ]);
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Offered 2 puzzles for swap");
    expect(options.description).toBe(
      "1 private puzzle is visible while it's on offer and private again once you withdraw every offer. 1 was already set that way. 1 is on loan, so it was left as it is.",
    );
  });

  it("sends a large selection in calls of at most 100 copies", async () => {
    const { result } = renderActions();
    const copies = Array.from({ length: 150 }, (_, i) => copy(`c${i}`));
    await act(() => result.current.offer("offerLend", copies));

    expect(offerCalls().map((c) => (c.copyIds as string[]).length)).toEqual([
      100, 50,
    ]);
    expect(offerCalls().every((c) => c.forLend === true)).toBe(true);
    expect(lastToast(mocks.toastSuccess).message).toBe(
      "Offered 150 puzzles to lend",
    );
  });

  it("withdraws every offer and Undo puts back each copy's own offers, not the skipped ones", async () => {
    mocks.mutation.mockImplementation(
      serverOffers([{ copyId: "agg_c", reason: "reserved" }]),
    );
    const { result } = renderActions();
    await act(() =>
      result.current.offer("withdraw", [
        copy("a", { availability: { ...CLOSED, forTrade: true } }),
        copy("b", { availability: { ...CLOSED, forLend: true } }),
        copy("c", { availability: { ...CLOSED, forTrade: true } }),
      ]),
    );

    expect(offerCalls()).toEqual([
      { copyIds: ["agg_a", "agg_b", "agg_c"], ...CLOSED },
    ]);
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Withdrew the offers on 2 puzzles");
    expect(options.description).toBe(
      "1 is part of an ongoing exchange, so it was left as it is.",
    );

    mocks.mutation.mockClear();
    await act(async () => options.action?.onClick());
    expect(offerCalls()).toEqual([
      { copyIds: ["agg_a"], forTrade: true, forLend: false, forSale: false },
      { copyIds: ["agg_b"], forTrade: false, forLend: true, forSale: false },
    ]);
  });

  it("says so when Undo is refused for a copy, such as one out on loan", async () => {
    const { result } = renderActions();
    await act(() =>
      result.current.offer("withdraw", [
        copy("a", { availability: { ...CLOSED, forTrade: true } }),
      ]),
    );
    const { options } = lastToast(mocks.toastSuccess);

    mocks.mutation.mockImplementation(
      serverOffers([{ copyId: "agg_a", reason: "onLoan" }]),
    );
    await act(async () => options.action?.onClick());
    expect(lastToast(mocks.toastError).message).toBe(
      "Couldn't undo that. Check the puzzles and try again.",
    );
  });

  it("never sends a visibility, even for private copies", async () => {
    const { result } = renderActions();
    await act(() =>
      result.current.offer("offerSwap", [copy("a", { visibility: "private" })]),
    );
    expect(offerCalls()[0]).not.toHaveProperty("visibility");
  });

  it("says nothing changed when every copy already was as asked", async () => {
    const { result } = renderActions();
    await act(() => result.current.offer("withdraw", [copy("a"), copy("b")]));
    expect(offerCalls()).toEqual([]);
    const { message, options } = lastToast(mocks.toastInfo);
    expect(message).toBe("Nothing changed");
    expect(options.description).toBe("2 were already set that way.");
  });

  it("reports a refused call as an error and keeps going with the next one", async () => {
    let call = 0;
    mocks.mutation.mockImplementation(async (name, args) => {
      call += 1;
      if (call === 1) throw new Error("rate limited");
      return serverOffers()(name, args);
    });
    const { result } = renderActions();
    const copies = Array.from({ length: 120 }, (_, i) => copy(`c${i}`));
    await act(() => result.current.offer("offerSwap", copies));

    expect(offerCalls()).toHaveLength(2);
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Offered 20 puzzles for swap");
    expect(options.description).toBe("100 couldn't be saved. Try again.");
  });

  it("shows an error when nothing could be saved", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    const { result } = renderActions();
    await act(() => result.current.offer("offerSwap", [copy("a")]));
    expect(lastToast(mocks.toastError).message).toBe(
      "1 couldn't be saved. Try again.",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("bulk add to collection", () => {
  it("adds the member's own copies and says how many housemates' copies stayed out", async () => {
    const { result } = renderActions({ housemates: ["b"] });
    await act(() =>
      result.current.addToCollection(
        { aggregateId: "col_1", name: "Holiday" },
        [copy("a"), copy("b"), copy("c")],
      ),
    );

    expect(
      mocks.mutation.mock.calls
        .filter(([name]) => name === ADD_TO_COLLECTION)
        .map(([, args]) => args),
    ).toEqual([
      { collectionId: "col_1", copyId: "agg_a" },
      { collectionId: "col_1", copyId: "agg_c" },
    ]);
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("2 puzzles are now in Holiday");
    expect(options.description).toBe(
      "1 belongs to a household member and stays out of your collections.",
    );
  });

  it("reports the copies that couldn't be added", async () => {
    mocks.mutation.mockImplementation(async (_name, args) => {
      if ((args as { copyId: string }).copyId === "agg_b")
        throw new Error("refused");
      return null;
    });
    const { result } = renderActions();
    await act(() =>
      result.current.addToCollection(
        { aggregateId: "col_1", name: "Holiday" },
        [copy("a"), copy("b")],
      ),
    );
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("1 puzzle is now in Holiday");
    expect(options.description).toBe("1 couldn't be added. Try again.");
  });
});

describe("bulk share with a circle", () => {
  const OFFERED = { ...CLOSED, forLend: true };
  const CIRCLE = { aggregateId: "circle_1", name: "Neighbours" };
  const offered = (id: string) => copy(id, { availability: OFFERED });
  const refusal = (code: string) => new ConvexError({ code, message: code });

  const shareCalls = () =>
    mocks.mutation.mock.calls
      .filter(([name]) => name === SHARE_COPIES)
      .map(([, args]) => args as { circleId: string; copyIds: string[] });

  // Answers shareCopiesToCircle as the server would: all or nothing, one refused copy refuses all.
  const serverShares =
    ({ gone = [] as string[], already = [] as string[] } = {}) =>
    async (_name: string, args: unknown): Promise<unknown> => {
      const { copyIds } = args as { copyIds: string[] };
      if (copyIds.some((id) => gone.includes(id)))
        throw refusal("CopyNotFound");
      const alreadyShared = copyIds.filter((id) => already.includes(id)).length;
      return { shared: copyIds.length - alreadyShared, alreadyShared };
    };

  it("shares the member's own copies and says what it left out", async () => {
    mocks.mutation.mockImplementation(serverShares({ already: ["agg_c"] }));
    const { result } = renderActions({ housemates: ["b"] });
    await act(() =>
      result.current.shareWithCircle(CIRCLE, [
        offered("a"),
        offered("b"),
        offered("c"),
        offered("d"),
      ]),
    );

    expect(shareCalls()).toEqual([
      { circleId: "circle_1", copyIds: ["agg_a", "agg_c", "agg_d"] },
    ]);
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Shared 2 puzzles with Neighbours");
    expect(options.description).toBe(
      "1 was already shared there. 1 belongs to a household member. Only the owner can share a puzzle.",
    );
  });

  it("says when circle members won't see what was shared", async () => {
    mocks.mutation.mockImplementation(serverShares());
    const { result } = renderActions();
    await act(() =>
      result.current.shareWithCircle(CIRCLE, [
        offered("a"),
        copy("b"),
        copy("c", { visibility: "private" }),
      ]),
    );
    expect(lastToast(mocks.toastSuccess).options.description).toBe(
      "2 aren't on offer, so circle members won't see them until you offer them.",
    );
  });

  it("names the copy that's gone and still shares the rest of its batch", async () => {
    mocks.mutation.mockImplementation(serverShares({ gone: ["agg_b"] }));
    const { result } = renderActions();
    await act(() =>
      result.current.shareWithCircle(CIRCLE, [
        offered("a"),
        offered("b"),
        offered("c"),
      ]),
    );
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Shared 2 puzzles with Neighbours");
    expect(options.description).toBe("1 is no longer in your library.");
  });

  it("doesn't warn about a copy that wasn't shared after all", async () => {
    mocks.mutation.mockImplementation(serverShares({ gone: ["agg_b"] }));
    const { result } = renderActions();
    await act(() =>
      result.current.shareWithCircle(CIRCLE, [offered("a"), copy("b")]),
    );
    expect(lastToast(mocks.toastSuccess).options.description).toBe(
      "1 is no longer in your library.",
    );
  });

  it("reports the copies a failed call took with it", async () => {
    let call = 0;
    mocks.mutation.mockImplementation(async (name, args) => {
      call += 1;
      if (call === 1) throw new Error("offline");
      return serverShares()(name, args);
    });
    const { result } = renderActions();
    await act(() =>
      result.current.shareWithCircle(
        CIRCLE,
        Array.from({ length: 120 }, (_, i) => offered(`c${i}`)),
      ),
    );
    const { message, options } = lastToast(mocks.toastSuccess);
    expect(message).toBe("Shared 20 puzzles with Neighbours");
    expect(options.description).toBe("100 couldn't be shared. Try again.");
  });

  it("says why the circle refused, when it refused everything", async () => {
    mocks.mutation.mockRejectedValue(refusal("CannotShareCopy"));
    const { result } = renderActions();
    await act(() => result.current.shareWithCircle(CIRCLE, [offered("a")]));
    expect(lastToast(mocks.toastError).message).toBe(
      "You have view-only access in this circle, so you can't share puzzles here.",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("shows an error when nothing could be shared for no stated reason", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    const { result } = renderActions();
    await act(() =>
      result.current.shareWithCircle(CIRCLE, [offered("a"), offered("b")]),
    );
    expect(lastToast(mocks.toastError).message).toBe(
      "2 couldn't be shared. Try again.",
    );
  });

  it("calls nothing for housemates' copies alone, and says why", async () => {
    const { result } = renderActions({ housemates: ["a"] });
    await act(() => result.current.shareWithCircle(CIRCLE, [offered("a")]));
    expect(shareCalls()).toEqual([]);
    const { message, options } = lastToast(mocks.toastInfo);
    expect(message).toBe("Nothing new was shared with Neighbours");
    expect(options.description).toBe(
      "1 belongs to a household member. Only the owner can share a puzzle.",
    );
  });

  it("says nothing new was shared when everything already was", async () => {
    mocks.mutation.mockImplementation(serverShares({ already: ["agg_a"] }));
    const { result } = renderActions();
    await act(() => result.current.shareWithCircle(CIRCLE, [offered("a")]));
    const { message, options } = lastToast(mocks.toastInfo);
    expect(message).toBe("Nothing new was shared with Neighbours");
    expect(options.description).toBe("1 was already shared there.");
  });
});
