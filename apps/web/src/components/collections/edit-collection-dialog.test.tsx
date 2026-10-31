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
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import {
  EditCollectionDialog,
  type EditableCollection,
} from "./edit-collection-dialog";

// The collection editor saves a non-empty name, says when the name is taken, and offers
// "Delete collection" (behind a confirm) for every collection except the default one.

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));
// The emoji field's localized names load over the network; not needed here.
vi.mock("@/lib/emoji-label", () => ({ useEmojiLabel: () => null }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const UPDATE = getFunctionName(gateway.collections.update);
const DELETE = getFunctionName(gateway.collections.delete);

const CATS: EditableCollection = {
  _id: "col_doc",
  aggregateId: "col_agg",
  name: "Cats",
  visibility: "private",
  isDefault: false,
};

const renderDialog = (collection: EditableCollection = CATS) => {
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <EditCollectionDialog
          open
          onOpenChange={onOpenChange}
          collection={collection}
          onDeleted={onDeleted}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange, onDeleted };
};

const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const saveButton = () =>
  screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("EditCollectionDialog: saving", () => {
  it("can't save a blank name", () => {
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(saveButton().disabled).toBe(true);
  });

  it("saves the trimmed name and closes", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "  Dogs " } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.mutation).toHaveBeenCalledWith(
      UPDATE,
      expect.objectContaining({ collectionId: "col_agg", name: "Dogs" }),
    );
  });

  it("says inline when the name is already taken, and stays open", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "DuplicateCollectionName", message: "taken" }),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Dogs" } });
    fireEvent.click(saveButton());
    expect(
      await screen.findByText("You already have a collection called “Dogs”."),
    ).toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("toasts any other save failure", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderDialog();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't save your changes. Please try again.",
      ),
    );
  });
});

describe("EditCollectionDialog: deleting", () => {
  const openConfirm = () => {
    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));
    return screen.getByRole("alertdialog");
  };

  it("asks first, then deletes, confirms and hands control back", async () => {
    const { onOpenChange, onDeleted } = renderDialog();
    const confirm = openConfirm();
    expect(within(confirm).getByText("Delete “Cats”?")).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(mocks.mutation).toHaveBeenCalledWith(DELETE, {
      collectionId: "col_agg",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Deleted “Cats”");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps everything open and toasts when the delete fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    const { onOpenChange, onDeleted } = renderDialog();
    const confirm = openConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't delete the collection. Please try again.",
      ),
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers no delete for the default collection", () => {
    renderDialog({ ...CATS, isDefault: true });
    expect(
      screen.queryByRole("button", { name: "Delete collection" }),
    ).toBeNull();
  });
});
