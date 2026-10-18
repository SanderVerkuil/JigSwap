// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { TYPING_TTL_MS } from "@jigswap/contracts";
import { cleanup, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TYPING_SEND_INTERVAL_MS,
  useTypingIndicator,
} from "./use-typing-indicator";

const SET = getFunctionName(gateway.conversation.setTyping);
const CLEAR = getFunctionName(gateway.conversation.clearTyping);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

const calls = () => mocks.mutation.mock.calls.map(([name]) => name);

const mount = (threadId = "thread_1") =>
  renderHook(({ id }) => useTypingIndicator(id), {
    initialProps: { id: threadId },
  });

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTypingIndicator", () => {
  it("sends setTyping on the first keystroke, then at most once per 4 s", () => {
    const { result } = mount();
    result.current.onInput("H");
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { threadId: "thread_1" });

    vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS - 1);
    result.current.onInput("He");
    expect(calls()).toEqual([SET]);

    vi.advanceTimersByTime(1);
    result.current.onInput("Hel");
    expect(calls()).toEqual([SET, SET]);
  });

  it("sends nothing for an empty or blank value, or while the tab is hidden", () => {
    const { result } = mount();
    result.current.onInput("");
    result.current.onInput("   ");
    setVisibility("hidden");
    result.current.onInput("Hi");
    expect(calls()).toEqual([]);
  });

  it("clears when the input is emptied while the indicator is live, not after it lapsed", () => {
    const { result } = mount();
    result.current.onInput("Hi");
    result.current.onInput("");
    expect(calls()).toEqual([SET, CLEAR]);
    // A second emptying has nothing left to clear.
    result.current.onInput("");
    expect(calls()).toEqual([SET, CLEAR]);

    vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS);
    result.current.onInput("Hi");
    vi.advanceTimersByTime(TYPING_TTL_MS);
    result.current.onInput("");
    expect(calls()).toEqual([SET, CLEAR, SET]);
  });

  it("keeps the 4 s leading edge across a stop: emptying and retyping can't resend sooner", () => {
    const { result } = mount();
    for (let i = 0; i < 5; i++) {
      result.current.onInput("Hi");
      result.current.onInput("");
    }
    expect(calls()).toEqual([SET, CLEAR]);

    vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS);
    result.current.onInput("Hi");
    expect(calls()).toEqual([SET, CLEAR, SET]);
  });

  it("has no idle clear: after 5 s without keystrokes nothing is sent", () => {
    const { result } = mount();
    result.current.onInput("Hi");
    vi.advanceTimersByTime(TYPING_TTL_MS + 4_000);
    expect(calls()).toEqual([SET]);
  });

  it("clears when the tab is hidden or the thread view unmounts while live", () => {
    const { result, unmount } = mount();
    result.current.onInput("Hi");
    setVisibility("hidden");
    expect(calls()).toEqual([SET, CLEAR]);

    setVisibility("visible");
    vi.advanceTimersByTime(TYPING_SEND_INTERVAL_MS);
    result.current.onInput("Hi again");
    unmount();
    expect(calls()).toEqual([SET, CLEAR, SET, CLEAR]);
  });

  it("moving to another thread clears the old one's and starts afresh", () => {
    const { result, rerender } = mount("thread_1");
    result.current.onInput("Hi");
    rerender({ id: "thread_2" });
    result.current.onInput("Hi");
    expect(mocks.mutation.mock.calls).toEqual([
      [SET, { threadId: "thread_1" }],
      [CLEAR, { threadId: "thread_1" }],
      [SET, { threadId: "thread_2" }],
    ]);
  });

  it("after a send (the server cleared the row) the next keystroke sends at once, with no clear", () => {
    const { result, unmount } = mount();
    result.current.onInput("Hi");
    result.current.onSent();
    result.current.onInput("Next");
    expect(calls()).toEqual([SET, SET]);

    result.current.onSent();
    unmount();
    expect(calls()).toEqual([SET, SET]);
  });

  it("ignores a failed call", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    const { result } = mount();
    expect(() => result.current.onInput("Hi")).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
