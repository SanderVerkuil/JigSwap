// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_TEXT_LIMITS } from "../add-puzzle/catalog-text-limits";
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

  it("a refusal for importing too much is reported as rate-limited, with when to try again", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    try {
      mocks.extract.mockRejectedValue(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      );
      expect(await runImport()).toEqual({
        status: "error",
        reason: "rateLimited",
        retryAt: 1_000_000 + 60_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // A store page's title or brand can be longer than the catalogue takes (TextTooLong), and
  // maxLength doesn't shorten a value set in code: the draft is clipped before it fills the form.
  it("clips the draft's text to the catalogue's limits", async () => {
    mocks.extract.mockResolvedValue({
      ok: true,
      draft: {
        title: "t".repeat(CATALOG_TEXT_LIMITS.title + 50),
        brand: "b".repeat(CATALOG_TEXT_LIMITS.brand + 1),
        description: "d".repeat(CATALOG_TEXT_LIMITS.description + 1),
        ean: "4005556000000",
        sourceUrl: "https://shop.example/puzzle",
      },
      match: null,
    });
    const state = await runImport();
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.draft).toEqual({
      title: "t".repeat(CATALOG_TEXT_LIMITS.title),
      brand: "b".repeat(CATALOG_TEXT_LIMITS.brand),
      description: "d".repeat(CATALOG_TEXT_LIMITS.description),
      ean: "4005556000000",
      sourceUrl: "https://shop.example/puzzle",
    });
  });

  it("leaves a draft within the limits as it is", async () => {
    const draft = {
      title: "Starry Night",
      brand: "Ravensburger",
      pieceCount: 1000,
      sourceUrl: "https://shop.example/puzzle",
    };
    mocks.extract.mockResolvedValue({ ok: true, draft, match: null });
    const state = await runImport();
    expect(state.status === "ready" && state.draft).toEqual(draft);
  });

  it("any other thrown error is a plain failure", async () => {
    mocks.extract.mockRejectedValue(new Error("network down"));
    expect(await runImport()).toEqual({ status: "error", reason: "failed" });
  });
});
