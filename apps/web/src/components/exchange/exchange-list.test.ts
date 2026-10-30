import type { ExchangeFields } from "@jigswap/contracts";
import { describe, expect, it } from "vitest";
import {
  splitNeedsYou,
  visibleExchanges,
  type ListedExchange,
} from "./exchange-list";

type Row = ListedExchange<
  Pick<
    ExchangeFields,
    | "status"
    | "initiatorConfirmationTimestamp"
    | "recipientConfirmationTimestamp"
  > & { id: string }
>;

const row = (
  id: string,
  direction: Row["direction"],
  status: ExchangeFields["status"],
  confirmed: Partial<
    Pick<
      ExchangeFields,
      "initiatorConfirmationTimestamp" | "recipientConfirmationTimestamp"
    >
  > = {},
): Row => ({ direction, exchange: { id, status, ...confirmed } });

const ids = (rows: readonly Row[]) => rows.map((r) => r.exchange.id);

describe("visibleExchanges", () => {
  const rows = [
    row("in-pending", "incoming", "proposed"),
    row("out-pending", "outgoing", "proposed"),
    row("in-done", "incoming", "completed"),
    row("out-done", "outgoing", "completed"),
  ];

  it("shows every exchange on All without a status filter", () => {
    expect(ids(visibleExchanges(rows, "all"))).toEqual([
      "in-pending",
      "out-pending",
      "in-done",
      "out-done",
    ]);
  });

  it("keeps one direction on Incoming and Outgoing", () => {
    expect(ids(visibleExchanges(rows, "incoming"))).toEqual([
      "in-pending",
      "in-done",
    ]);
    expect(ids(visibleExchanges(rows, "outgoing"))).toEqual([
      "out-pending",
      "out-done",
    ]);
  });

  it("narrows to one status, completed included, on any tab", () => {
    expect(ids(visibleExchanges(rows, "all", "completed"))).toEqual([
      "in-done",
      "out-done",
    ]);
    expect(ids(visibleExchanges(rows, "outgoing", "proposed"))).toEqual([
      "out-pending",
    ]);
    expect(visibleExchanges(rows, "incoming", "disputed")).toEqual([]);
  });
});

describe("splitNeedsYou", () => {
  it("puts what waits on the viewer first and keeps each group's order", () => {
    const { needsYou, others } = splitNeedsYou([
      row("sent", "outgoing", "proposed"),
      row("asked", "incoming", "proposed"),
      row("done", "incoming", "completed"),
      row("partner-confirmed", "outgoing", "accepted", {
        recipientConfirmationTimestamp: 1,
      }),
      row("i-confirmed", "outgoing", "accepted", {
        initiatorConfirmationTimestamp: 1,
      }),
      row("nobody-confirmed", "incoming", "accepted"),
    ]);
    expect(ids(needsYou)).toEqual([
      "asked",
      "partner-confirmed",
      "nobody-confirmed",
    ]);
    expect(ids(others)).toEqual(["sent", "done", "i-confirmed"]);
  });

  it("has an empty Needs you group when nothing waits on the viewer", () => {
    const { needsYou, others } = splitNeedsYou([
      row("declined", "incoming", "rejected"),
    ]);
    expect(needsYou).toEqual([]);
    expect(ids(others)).toEqual(["declined"]);
  });
});
