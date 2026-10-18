import { describe, expect, it } from "vitest";
import { anchoredScrollTop } from "./thread-scroll";

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
