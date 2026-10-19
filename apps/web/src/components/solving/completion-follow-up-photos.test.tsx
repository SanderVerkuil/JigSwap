// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useEffect } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import {
  CompletionFollowUpProvider,
  useCompletionFollowUp,
} from "./completion-follow-up-provider";

// Completion photos go through the shared canvas re-encode (lib/prepare-photo), like message
// photos: what is uploaded is the re-encoded JPEG, never the picked file.

const UPLOAD_URL = getFunctionName(gateway.library.generateUploadUrl);
const ATTACH = getFunctionName(gateway.solving.attachCompletionPhotos);

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  prepare: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

vi.mock("@/lib/prepare-photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prepare-photo")>()),
  preparePhoto: mocks.prepare,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const reencoded = new Blob(["re-encoded jpeg"], { type: "image/jpeg" });
const fetchMock = vi.fn();

function OpenFollowUp() {
  const { requestFollowUp } = useCompletionFollowUp();
  useEffect(() => {
    requestFollowUp({ completionId: "c1", puzzleId: null, copyId: null });
  }, [requestFollowUp]);
  return null;
}

const renderProvider = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CompletionFollowUpProvider>
          <OpenFollowUp />
        </CompletionFollowUpProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );

const pick = async (file: File) => {
  const input = await waitFor(() =>
    document.querySelector<HTMLInputElement>("input[type='file']")!,
  );
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  mocks.prepare.mockReset().mockResolvedValue({
    file: reencoded,
    width: 1600,
    height: 1200,
  });
  mocks.mutation.mockReset().mockImplementation(async (name) => {
    if (name === UPLOAD_URL) return "https://upload.test";
    return null;
  });
  fetchMock
    .mockReset()
    .mockResolvedValue(
      new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("completion follow-up photos", () => {
  it("re-encodes a picked photo and uploads the JPEG, not the original", async () => {
    renderProvider();
    const original = new File(["original with exif"], "IMG_1.HEIC", {
      type: "image/heic",
    });

    await pick(original);
    expect(mocks.prepare).toHaveBeenCalledWith(original);
    await screen.findByRole("button", { name: "Remove photo" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(ATTACH, {
        completionId: "c1",
        storageIds: ["storage_1"],
      }),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://upload.test");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "image/jpeg",
    );
    expect(await (init.body as Blob).text()).toBe("re-encoded jpeg");
  });

  it("a photo the browser cannot prepare is not added", async () => {
    mocks.prepare.mockRejectedValue(new Error("EncodingError"));
    renderProvider();

    await pick(new File(["?"], "x.heic", { type: "image/heic" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Upload failed"),
    );
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });
});
