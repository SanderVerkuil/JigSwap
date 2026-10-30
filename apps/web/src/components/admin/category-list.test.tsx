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

const category: Category = {
  _id: "row-1",
  aggregateId: "cat-1",
  name: { en: "Landscapes", nl: "Landschappen" },
  isActive: true,
  sortOrder: 0,
};

const renderList = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CategoryList categories={[category]} onEdit={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );

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
});
