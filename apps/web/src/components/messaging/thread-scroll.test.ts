import { describe, expect, it } from "vitest";
import { anchoredScrollTop, isNearBottom } from "./thread-scroll";

const ids = (list: string[]) => list.map((id) => ({ id }));
const snapshot = { oldestId: "m3", scrollTop: 40, scrollHeight: 1000 };

describe("anchoredScrollTop", () => {
  it("shifts scrollTop by the height the prepended page added", () => {
    expect(
      anchoredScrollTop(snapshot, ids(["m1", "m2", "m3", "m4"]), 1600),
    ).toBe(640);
  });

  it("keeps a reader at the very top anchored to what they saw", () => {
    expect(
      anchoredScrollTop({ ...snapshot, scrollTop: 0 }, ids(["m1", "m3"]), 1250),
    ).toBe(250);
  });

  it("does nothing on first load (no snapshot or no oldest id yet)", () => {
    expect(anchoredScrollTop(undefined, ids(["m1"]), 500)).toBeUndefined();
    expect(
      anchoredScrollTop({ ...snapshot, oldestId: undefined }, ids(["m1"]), 500),
    ).toBeUndefined();
  });

  it("does nothing when the oldest message is unchanged (an append)", () => {
    expect(anchoredScrollTop(snapshot, ids(["m3", "m4", "m5"]), 1400)).toBe(
      undefined,
    );
  });

  it("does nothing when the previous oldest is gone (a thread switch)", () => {
    expect(anchoredScrollTop(snapshot, ids(["x1", "x2"]), 800)).toBeUndefined();
    expect(anchoredScrollTop(snapshot, [], 0)).toBeUndefined();
  });
});

describe("isNearBottom", () => {
  const at = (scrollTop: number) => ({
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop,
  });

  it("is true at the bottom and within 120px of it", () => {
    expect(isNearBottom(at(600))).toBe(true);
    expect(isNearBottom(at(481))).toBe(true);
  });

  it("is false further up", () => {
    expect(isNearBottom(at(480))).toBe(false);
    expect(isNearBottom(at(0))).toBe(false);
  });

  it("is true for a list that doesn't scroll", () => {
    expect(
      isNearBottom({ scrollHeight: 300, clientHeight: 400, scrollTop: 0 }),
    ).toBe(true);
  });
});
