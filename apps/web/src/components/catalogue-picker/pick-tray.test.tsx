// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPickTray,
  parseTray,
  trayOutlivesLeavingTo,
  usePickTray,
} from "./pick-tray";
import type { Pick } from "./selection";

const mocks = vi.hoisted(() => ({ memberId: "member_a" }));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: mocks.memberId } }),
}));

const STORAGE_KEY = "jigswap.cataloguePicker.tray";
const pick = (id: string): Pick => ({
  definitionId: id,
  title: `Puzzle ${id}`,
  pending: false,
  forTrade: false,
});

beforeEach(() => {
  mocks.memberId = "member_a";
  clearPickTray();
});
afterEach(cleanup);

describe("usePickTray", () => {
  it("keeps the picks when the picker unmounts and comes back", () => {
    const first = renderHook(() => usePickTray());
    act(() => first.result.current.update(() => [pick("1"), pick("2")]));
    first.unmount();

    const second = renderHook(() => usePickTray());
    expect(second.result.current.picks.map((p) => p.definitionId)).toEqual([
      "1",
      "2",
    ]);
  });

  it("survives a reload through sessionStorage", async () => {
    const { result } = renderHook(() => usePickTray());
    act(() => result.current.update(() => [pick("1")]));

    // A reload starts from a fresh module with only sessionStorage to go on.
    vi.resetModules();
    const reloaded = await import("./pick-tray");
    const after = renderHook(() => reloaded.usePickTray());
    expect(after.result.current.picks.map((p) => p.definitionId)).toEqual([
      "1",
    ]);
    act(() => reloaded.clearPickTray());
  });

  it("clears storage once the tray is empty", () => {
    const { result } = renderHook(() => usePickTray());
    act(() => result.current.update(() => [pick("1")]));
    expect(sessionStorage.getItem(STORAGE_KEY)).toContain("Puzzle 1");

    act(() => result.current.update(() => []));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("empties on Discard", () => {
    const { result } = renderHook(() => usePickTray());
    act(() => result.current.update(() => [pick("1")]));
    act(() => clearPickTray());
    expect(result.current.picks).toEqual([]);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not show a tray to another member signing in in the same tab", () => {
    const { result, rerender } = renderHook(() => usePickTray());
    act(() => result.current.update(() => [pick("1")]));

    mocks.memberId = "member_b";
    rerender();
    expect(result.current.picks).toEqual([]);

    mocks.memberId = "member_a";
    rerender();
    expect(result.current.picks).toHaveLength(1);
  });

  it("works from memory when storage is blocked", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    const { result } = renderHook(() => usePickTray());
    act(() => result.current.update(() => [pick("1")]));
    expect(result.current.picks).toHaveLength(1);
    setItem.mockRestore();
  });
});

describe("parseTray", () => {
  it("ignores anything that isn't a tray", () => {
    expect(parseTray(null).picks).toEqual([]);
    expect(parseTray("not json").picks).toEqual([]);
    expect(parseTray('{"picks":"nope"}').picks).toEqual([]);
    expect(parseTray('{"picks":[{"title":"no id"},null]}').picks).toEqual([]);
  });

  it("fills in what an older tray lacks and caps it at the limit", () => {
    const stored = {
      owner: "member_a",
      picks: Array.from({ length: 150 }, (_, i) => ({
        definitionId: String(i),
        title: `Puzzle ${i}`,
      })),
    };
    const { owner, picks } = parseTray(JSON.stringify(stored));
    expect(owner).toBe("member_a");
    expect(picks).toHaveLength(100);
    expect(picks[0]).toEqual({
      definitionId: "0",
      title: "Puzzle 0",
      pending: false,
      forTrade: false,
    });
  });
});

describe("trayOutlivesLeavingTo", () => {
  it("is the register form only", () => {
    expect(trayOutlivesLeavingTo("/my-puzzles/add/new")).toBe(true);
    expect(trayOutlivesLeavingTo("/my-puzzles/add")).toBe(false);
    expect(trayOutlivesLeavingTo("/goals")).toBe(false);
  });
});
