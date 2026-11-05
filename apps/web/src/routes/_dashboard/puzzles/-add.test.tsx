// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { UploadRateLimitedError } from "@/lib/upload-rate-limit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexError } from "convex/values";
import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./add";

// The catalogue "Add a puzzle" submission (SEC-20): a box-art upload refused by the member's
// upload limit says to wait; a refusal of the submit itself keeps the form's own message. The
// form's building blocks are stubbed down to what reaches the submission: a title, a piece count
// and an uploaded cover photo.

const mocks = vi.hoisted(() => ({
  uploadBoxArt: vi.fn<(file: File) => Promise<string>>(),
  createPuzzle: vi.fn<(args: unknown) => Promise<unknown>>(),
}));

vi.mock("@/components/add-puzzle", async () => ({
  // The text bounds and the refusal mapping stay real: the refusal mapping is under test here. The
  // duplicate check's pure helpers run on every render of the form.
  ...(await vi.importActual("@/components/add-puzzle/catalog-text-limits")),
  ...(await vi.importActual("@/components/add-puzzle/contribute-error")),
  ...(await vi.importActual("@/components/add-puzzle/duplicate-check")),
  AddPuzzleLayout: ({ form }: { form: ReactNode }) => <>{form}</>,
  AddPuzzleSummary: () => null,
  DIFFICULTY_OPTIONS: [],
  CoverColourField: ({
    onUploadPhoto,
  }: {
    onUploadPhoto: (file: File) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onUploadPhoto(new File(["art"], "box.jpg", { type: "image/jpeg" }))
      }
    >
      pick cover
    </button>
  ),
  PieceCountField: ({ onChange }: { onChange: (n: number) => void }) => (
    <button type="button" onClick={() => onChange(1000)}>
      pick pieces
    </button>
  ),
  ImportZone: () => null,
  LivePreviewCard: () => null,
  MatchConfirm: () => null,
  ReadinessChecklist: () => null,
  SectionDivider: () => null,
  SegmentedPills: () => null,
  SuggestInput: () => null,
  TagInput: () => null,
}));
vi.mock("@/hooks/use-upload-box-art", () => ({
  useUploadBoxArt: () => mocks.uploadBoxArt,
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtCheckNotice: () => async () => {},
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/gateway", () => ({
  gateway: { catalog: {} },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({ queryKey: ["stub"], queryFn: async () => [] }),
  useConvexMutation: () => mocks.createPuzzle,
  useConvexAction: () => async () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const renderPage = () => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

// Fill what the submission needs, with an uploaded cover, and press Contribute.
const contribute = () => {
  fireEvent.change(screen.getByLabelText(en.puzzles.fieldTitle), {
    target: { value: "Harbour at dusk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "pick pieces" }));
  fireEvent.click(screen.getByRole("button", { name: "pick cover" }));
  fireEvent.click(
    screen.getByRole("button", { name: en.puzzles.contributePuzzle }),
  );
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.uploadBoxArt.mockReset();
  mocks.createPuzzle.mockReset().mockResolvedValue("puzzle_1");
  vi.mocked(toast.error).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("contribute a puzzle", () => {
  it("a box-art upload refused by the upload limit tells the member to wait", async () => {
    mocks.uploadBoxArt.mockRejectedValue(
      new UploadRateLimitedError(new ConvexError({ code: "RateLimited" })),
    );
    renderPage();
    contribute();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        en.common.photoUploadRateLimited,
      ),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      en.puzzles.puzzleCreationFailed,
    );
    expect(mocks.createPuzzle).not.toHaveBeenCalled();
  });

  it("a RateLimited refusal of the submit itself keeps the form's own message", async () => {
    mocks.uploadBoxArt.mockResolvedValue("clean_1");
    mocks.createPuzzle.mockRejectedValue(
      new ConvexError({ code: "RateLimited" }),
    );
    renderPage();
    contribute();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(en.puzzles.puzzleCreationFailed),
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      en.common.photoUploadRateLimited,
    );
  });
});
