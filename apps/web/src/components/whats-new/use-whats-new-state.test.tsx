// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWhatsNewState } from "./use-whats-new-state";

const mocks = vi.hoisted(() => ({ entriesLoaded: 0 }));

vi.mock("@jigswap/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jigswap/contracts")>()),
  WHATS_NEW_MANIFEST: [
    { id: "known-b", publishedAt: 2, highlight: false, notify: false },
    { id: "known-a", publishedAt: 1, highlight: true, notify: true },
  ],
}));

// The entry bodies: the shell-wide state must never pull them in.
vi.mock("./entries", () => {
  mocks.entriesLoaded++;
  return { WHATS_NEW_ENTRIES: [] };
});

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "member_me" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      unreadIds: ["known-a", "only-on-the-server", "known-b"],
      tours: [],
    },
  }),
}));

afterEach(cleanup);

describe("useWhatsNewState", () => {
  it("keeps the unread ids this deploy knows (from the manifest), without loading entry bodies", () => {
    const { result } = renderHook(() => useWhatsNewState());
    expect(result.current.unreadIds).toEqual(["known-a", "known-b"]);
    expect(mocks.entriesLoaded).toBe(0);
  });
});
