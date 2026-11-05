import { vi } from "vitest";
import type * as PublicFetch from "../convex/catalog/adapters/publicFetch";

// Test double for catalog/adapters/publicFetch, for convex-test suites that fake the network with
// a stubbed global `fetch`: fetchPublic answers through that fetch (no DNS, no sockets) and is a
// vi.fn, so a test can make it refuse a host with mockResolvedValueOnce. readBodyCapped stays real.
// The real transport is covered by publicFetch.test.ts. Use as:
//   vi.mock("./catalog/adapters/publicFetch", async (importOriginal) =>
//     (await import("../test-fixtures/publicFetchViaGlobalFetch")).publicFetchViaGlobalFetch(
//       importOriginal,
//     ),
//   );
export const publicFetchViaGlobalFetch = async (
  importOriginal: () => Promise<typeof PublicFetch>,
) => ({
  ...(await importOriginal()),
  fetchPublic: vi.fn(
    async (
      url: string,
      { headers, signal }: PublicFetch.PublicFetchOptions,
    ) => ({
      ok: true as const,
      response: await fetch(url, { headers, signal }),
      finalUrl: url,
    }),
  ),
});
