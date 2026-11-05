// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { cleanup, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCurrentMember } from "./use-current-member";

// Follows Clerk's session, which is known during SSR and hydration, so a member the server loaded
// reaches the first paint.

const state = vi.hoisted(() => ({
  isSignedIn: undefined as boolean | undefined,
  member: undefined as unknown,
  asked: undefined as unknown,
}));

vi.mock("@/compat/clerk", () => ({
  useAuth: () => ({ isSignedIn: state.isSignedIn }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => {
    expect(options.queryKey[1]).toBe(
      getFunctionName(gateway.identity.currentUser),
    );
    state.asked = options.queryKey[2];
    return { data: state.asked === "skip" ? undefined : state.member };
  },
}));

afterEach(() => {
  cleanup();
  state.member = undefined;
  state.asked = undefined;
});

describe("useCurrentMember", () => {
  it("has the member a signed-in session's first render finds in the cache", () => {
    state.isSignedIn = true;
    state.member = { _id: "me" };
    const { result } = renderHook(() => useCurrentMember());
    expect(state.asked).toEqual({});
    expect(result.current).toEqual({
      member: { _id: "me" },
      isMemberLoading: false,
    });
  });

  it("is loading while a signed-in member's read is on its way", () => {
    state.isSignedIn = true;
    const { result } = renderHook(() => useCurrentMember());
    expect(result.current.isMemberLoading).toBe(true);
  });

  it("settles on no member when the backend knows none", () => {
    state.isSignedIn = true;
    state.member = null;
    const { result } = renderHook(() => useCurrentMember());
    expect(result.current).toEqual({ member: null, isMemberLoading: false });
  });

  it.each([
    ["signed out", false],
    ["before Clerk knows", undefined],
  ])("reads nothing %s", (_, isSignedIn) => {
    state.isSignedIn = isSignedIn;
    const { result } = renderHook(() => useCurrentMember());
    expect(state.asked).toBe("skip");
    expect(result.current.isMemberLoading).toBe(false);
  });
});
