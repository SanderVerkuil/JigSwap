// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePuzzleImport } from "./use-puzzle-import";

// A store-link import either fills the form, or fails; a failure caused by the member's import
// limit (the server's RateLimited refusal) is told apart, so the zone can say so.

const mocks = vi.hoisted(() => ({
  extract: vi.fn<(args: { url: string }) => Promise<unknown>>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexAction: () => mocks.extract,
}));

const runImport = async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePuzzleImport(), { wrapper });
  await act(() => result.current.run("https://shop.example/puzzle"));
  return result.current.state;
};

beforeEach(() => {
  mocks.extract.mockReset();
});

describe("usePuzzleImport", () => {
  it("a page the server could not read is a plain failure", async () => {
    mocks.extract.mockResolvedValue({ ok: false, code: "FetchFailed" });
    expect(await runImport()).toEqual({ status: "error", reason: "failed" });
  });

  it("a refusal for importing too much is reported as rate-limited", async () => {
    mocks.extract.mockRejectedValue(
      new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
    );
    expect(await runImport()).toEqual({
      status: "error",
      reason: "rateLimited",
    });
  });

  it("any other thrown error is a plain failure", async () => {
    mocks.extract.mockRejectedValue(new Error("network down"));
    expect(await runImport()).toEqual({ status: "error", reason: "failed" });
  });
});
