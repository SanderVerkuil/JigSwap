import { describe, expect, test } from "vitest";
import { tradeEventOf } from "./conversation/readModelHelpers";

describe("tradeEventOf", () => {
  test("a stored tradeEvent wins over the body", () => {
    expect(
      tradeEventOf({
        kind: "system",
        body: "exchange_completed",
        tradeEvent: { kind: "completed" },
      }),
    ).toEqual({ kind: "completed" });
  });

  test.each([
    ["Exchange proposed", "proposed"],
    ["Exchange accepted", "accepted"],
    ["Exchange rejected", "rejected"],
    ["Exchange cancelled", "cancelled"],
    ["Exchange completed", "completed"],
    [
      "Exchange cancelled: the other member deleted their account",
      "cancelled_member_deleted",
    ],
  ])("a legacy system row %j maps to %s", (body, kind) => {
    expect(tradeEventOf({ kind: "system", body })).toEqual({ kind });
  });

  test("an unknown system body, a prototype key or a member's text is not a trade line", () => {
    expect(tradeEventOf({ kind: "system", body: "member_joined" })).toBe(
      undefined,
    );
    expect(tradeEventOf({ kind: "system", body: "constructor" })).toBe(
      undefined,
    );
    expect(tradeEventOf({ kind: "text", body: "Exchange accepted" })).toBe(
      undefined,
    );
  });
});
