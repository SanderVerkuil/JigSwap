// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadBoxArt } from "./use-upload-box-art";

// Box art: canvas re-encode, upload, then the server-side strip; the clean id comes back.

const SANITIZE = getFunctionName(gateway.catalog.sanitizeBoxArt);

const mocks = vi.hoisted(() => ({
  call: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  prepare: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const hook =
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.call(getFunctionName(ref), args);
  return {
    ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
    useConvexMutation: hook,
    useConvexAction: hook,
  };
});

vi.mock("@/lib/prepare-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prepare-photo")>()),
  preparePhoto: mocks.prepare,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  mocks.prepare.mockReset().mockResolvedValue({
    file: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1600,
    height: 1200,
  });
  mocks.call
    .mockReset()
    .mockImplementation(async (name) =>
      name === SANITIZE ? "clean_1" : "https://upload.test",
    );
  fetchMock
    .mockReset()
    .mockResolvedValue(
      new Response(JSON.stringify({ storageId: "raw_1" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useUploadBoxArt", () => {
  it("uploads the re-encoded JPEG and returns the server-cleaned id", async () => {
    const { result } = renderHook(() => useUploadBoxArt());
    const picked = new File(["original"], "box.png", { type: "image/png" });

    await expect(result.current(picked)).resolves.toBe("clean_1");

    expect(mocks.prepare).toHaveBeenCalledWith(picked);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "image/jpeg",
    );
    expect(await (init.body as Blob).text()).toBe("jpeg");
    expect(mocks.call).toHaveBeenCalledWith(SANITIZE, { storageId: "raw_1" });
  });

  it("a failed upload is never sent for cleaning", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const { result } = renderHook(() => useUploadBoxArt());

    await expect(
      result.current(new File(["x"], "box.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow();
    expect(mocks.call).not.toHaveBeenCalledWith(SANITIZE, expect.anything());
  });
});
