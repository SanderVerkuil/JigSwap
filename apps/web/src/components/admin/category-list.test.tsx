// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { CategoryList, type Category } from "./category-list";

type ToastOptions = { action?: { label: string; onClick: () => void } };

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
// The reorder mutation chains withOptimisticUpdate, so the stub carries it too.
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const fn = (args: unknown) => mocks.mutation(getFunctionName(ref), args);
    return Object.assign(fn, { withOptimisticUpdate: () => fn });
  },
}));

const SET_ACTIVE = getFunctionName(gateway.adminCatalog.delete);
const REORDER = getFunctionName(gateway.adminCatalog.reorder);

const category: Category = {
  _id: "row-1",
  aggregateId: "cat-1",
  name: { en: "Landscapes", nl: "Landschappen" },
  isActive: true,
  sortOrder: 0,
};

const renderList = (categories: Category[] = [category]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CategoryList categories={categories} onEdit={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );

const threeRows: Category[] = [
  category,
  {
    _id: "row-2",
    aggregateId: "cat-2",
    name: { en: "Art", nl: "Kunst" },
    isActive: true,
    sortOrder: 1,
  },
  {
    _id: "row-3",
    aggregateId: "cat-3",
    name: { en: "Cities", nl: "Steden" },
    isActive: true,
    sortOrder: 2,
  },
];

const openRowMenu = async (name: string) => {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `More actions for ${name}` }),
    { key: "Enter" },
  );
  await screen.findAllByRole("menuitem");
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("CategoryList", () => {
  it("deactivates after the confirm and offers Undo, which reactivates the category", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Deactivate",
      }),
    );
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(SET_ACTIVE, {
        catalogCategoryId: "cat-1",
        isActive: false,
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Category deactivated successfully",
        expect.anything(),
      ),
    );

    const undo = mocks.toastSuccess.mock.lastCall?.[1]?.action;
    expect(undo?.label).toBe("Undo");
    undo!.onClick();
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenLastCalledWith(SET_ACTIVE, {
        catalogCategoryId: "cat-1",
        isActive: true,
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenLastCalledWith(
        "Category reactivated successfully",
      ),
    );
  });

  it("moves a category up from its row menu, renumbering the whole list", async () => {
    renderList(threeRows);
    await openRowMenu("Cities");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(REORDER, {
        order: [
          { catalogCategoryId: "cat-1", sortOrder: 0 },
          { catalogCategoryId: "cat-3", sortOrder: 1 },
          { catalogCategoryId: "cat-2", sortOrder: 2 },
        ],
      }),
    );
  });

  it("disables moving past either end of the list", async () => {
    renderList(threeRows);
    await openRowMenu("Landscapes");
    expect(
      screen.getByRole("menuitem", { name: "Move up" }).dataset.disabled,
    ).toBeDefined();
    expect(
      screen.getByRole("menuitem", { name: "Move down" }).dataset.disabled,
    ).toBeUndefined();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await openRowMenu("Cities");
    expect(
      screen.getByRole("menuitem", { name: "Move down" }).dataset.disabled,
    ).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("dims an inactive row's swatch and name, never the row: its text must stay readable", () => {
    const { container } = renderList([
      { ...category, isActive: false, color: "#123456" },
    ]);
    const name = screen.getByText("Landscapes");
    expect(name.className).toContain("text-muted-foreground");
    const row = container.querySelector(".border-b");
    expect(row?.className).not.toContain("opacity-60");
    expect(
      container.querySelector("span[aria-hidden].h-9")?.className,
    ).toContain("opacity-60");
  });

  it("gives the drag grip a touch-sized hit area and disables the menu on legacy rows", () => {
    renderList([
      {
        _id: "legacy",
        name: { en: "Animals", nl: "Dieren" },
        isActive: true,
        sortOrder: 0,
      },
    ]);
    const grip = screen.getByRole("button", {
      name: "Drag to reorder Animals",
    });
    expect(grip.className).toContain("size-11");
    expect(grip).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "More actions for Animals" }),
    ).toHaveProperty("disabled", true);
  });

  it("shows a missing translation as a visible badge and keeps present ones focusable", () => {
    renderList([
      category,
      {
        ...category,
        _id: "row-2",
        aggregateId: "cat-2",
        name: { en: "Vintage", nl: " " },
      },
    ]);
    // The Dutch name of "Landscapes" is a focusable tooltip trigger…
    const flag = screen.getByRole("button", { name: "Dutch: “Landschappen”" });
    flag.focus();
    expect(document.activeElement).toBe(flag);
    // …and the missing one is spelled out on the row, not hidden in a tooltip.
    expect(screen.getAllByText("Dutch missing")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Dutch: “ ”/ })).toBeNull();
  });

  it("falls back to another translation when the UI locale's name is missing", () => {
    renderList([
      {
        _id: "legacy",
        name: { en: "", nl: "Dieren" },
        isActive: true,
        sortOrder: 0,
      },
    ]);
    expect(screen.getByText("Dieren")).toBeTruthy();
    expect(screen.getByText("English missing")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Drag to reorder Dieren" }),
    ).toBeTruthy();
  });
});
