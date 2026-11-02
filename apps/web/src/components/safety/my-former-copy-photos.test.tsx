// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MyFormerCopyPhotos } from "./my-former-copy-photos";

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown, opts: unknown) => unknown>(),
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  loadMore: vi.fn<(n: number) => void>(),
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown, opts: unknown) =>
    mocks.paginated(ref, args, opts),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

const REMOVE = getFunctionName(gateway.library.removeCopyPhoto);
const ADDED = new Date("2026-03-04T12:00:00Z").getTime();

const list = (
  results: unknown[],
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted",
) => {
  mocks.paginated.mockReturnValue({
    results,
    status,
    loadMore: mocks.loadMore,
  });
};

const renderSection = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <MyFormerCopyPhotos />
    </IntlProvider>,
  );

const photo = (imageId: string, extra: object = {}) => ({
  imageId,
  url: `https://img.example/${imageId}.jpg`,
  createdAt: ADDED,
  ...extra,
});

beforeEach(() => {
  mocks.paginated.mockReset();
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.loadMore.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
});
afterEach(cleanup);

describe("MyFormerCopyPhotos", () => {
  it("shows nothing while there is nothing to act on", () => {
    list([], "Exhausted");
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing while it loads", () => {
    list([], "LoadingFirstPage");
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();
  });

  it("lists the member's photos with what they added, and nothing about the copy", () => {
    list(
      [
        photo("img_a", { title: "Our living room" }),
        photo("img_b", { url: null }),
      ],
      "Exhausted",
    );
    renderSection();
    expect(
      screen.getByRole("heading", {
        name: "Photos of puzzles you no longer have",
      }),
    ).toBeTruthy();
    const [captioned, unchecked] = screen.getAllByRole("listitem");
    expect(within(captioned!).getByText("Our living room")).toBeTruthy();
    expect(captioned!.textContent).toContain("Added Mar 4, 2026");
    expect(
      within(captioned!).getByRole("img", { name: "Our living room" }),
    ).toBeTruthy();
    // No URL yet (its checks have not passed): a placeholder, and it can still be removed.
    expect(within(unchecked!).getByText("Your photo")).toBeTruthy();
    expect(unchecked!.querySelector("img")).toBeNull();
    expect(
      within(unchecked!).getByRole("button", {
        name: "Remove Your photo, added Mar 4, 2026",
      }),
    ).toBeTruthy();
  });

  it("removes a photo only after the inline confirm", async () => {
    list([photo("img_a")], "Exhausted");
    renderSection();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Your photo, added Mar 4, 2026",
      }),
    );
    const group = screen.getByRole("group", {
      name: "Remove this photo for good? It also goes for whoever has the puzzle now.",
    });
    expect(mocks.mutation).not.toHaveBeenCalled();
    fireEvent.click(
      within(group).getByRole("button", { name: "Remove photo" }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(REMOVE, {
        imageId: "img_a",
      }),
    );
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("Photo removed"),
    );
  });

  // Inline, not an AlertDialog: this section lives in Clerk's profile modal, which stacks above the
  // app's dialogs, so a dialog would open out of sight behind it.
  it("confirms inline, without a dialog, and focus follows the confirm in and out", () => {
    list([photo("img_a")], "Exhausted");
    renderSection();
    const remove = screen.getByRole("button", { name: /^Remove / });
    fireEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const cancel = within(screen.getByRole("group")).getByRole("button", {
      name: "Cancel",
    });
    expect(document.activeElement).toBe(cancel);

    fireEvent.click(cancel);
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Remove / }),
    );
  });

  it("says so when removing fails, and the confirm stays", async () => {
    mocks.mutation.mockRejectedValue(new Error("nope"));
    list([photo("img_a")], "Exhausted");
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Remove / }));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Couldn't remove the photo"),
    );
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("keeps reading while a filtered page leaves too little to show", () => {
    list([photo("img_a")], "CanLoadMore");
    renderSection();
    expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  });

  it("offers more once a screenful is on it", () => {
    const full = Array.from({ length: 10 }, (_, i) => photo(`img_${i}`));
    list(full, "CanLoadMore");
    renderSection();
    expect(mocks.loadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(mocks.loadMore).toHaveBeenCalledTimes(1);
  });

  it("renders in Dutch", () => {
    list([photo("img_a")], "Exhausted");
    renderSection("nl");
    expect(
      screen.getByRole("heading", {
        name: "Foto's van puzzels die je niet meer hebt",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Je foto")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toContain(
      "Toegevoegd op 4 mrt 2026",
    );
  });
});
