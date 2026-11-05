// @vitest-environment happy-dom
// UX-06: the phone chrome's live counts. Both reads need a member (requireMember), so they skip
// until the member is known, and the request count is only the incoming requests still waiting for
// the member's answer, the same definition as the dashboard's pending banner.
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePendingRequestCount, useUnreadMessageCount } from "./nav-counts";

const mocks = vi.hoisted(() => ({
  member: null as { _id: string } | null,
  data: undefined as unknown,
  args: [] as unknown[],
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (_query: unknown, args: unknown) => {
    mocks.args.push(args);
    return { queryKey: ["convexQuery", args] };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.data }),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: mocks.member }),
}));

afterEach(() => {
  cleanup();
  mocks.member = null;
  mocks.data = undefined;
  mocks.args = [];
});

describe("useUnreadMessageCount", () => {
  it("skips the read until the member is known and reads 0", () => {
    const { result } = renderHook(() => useUnreadMessageCount());
    expect(mocks.args).toContain("skip");
    expect(result.current).toBe(0);
  });

  it("returns the member's unread total", () => {
    mocks.member = { _id: "m1" };
    mocks.data = 4;
    const { result } = renderHook(() => useUnreadMessageCount());
    expect(mocks.args).not.toContain("skip");
    expect(result.current).toBe(4);
  });
});

describe("usePendingRequestCount", () => {
  it("skips the read until the member is known and reads 0", () => {
    const { result } = renderHook(() => usePendingRequestCount());
    expect(mocks.args).toContain("skip");
    expect(result.current).toBe(0);
  });

  it("counts only incoming requests still waiting for the member's answer", () => {
    mocks.member = { _id: "m1" };
    mocks.data = [
      { userRole: "owner", status: "proposed" },
      { userRole: "owner", status: "proposed" },
      { userRole: "owner", status: "accepted" },
      { userRole: "requester", status: "proposed" },
    ];
    const { result } = renderHook(() => usePendingRequestCount());
    expect(result.current).toBe(2);
  });
});
