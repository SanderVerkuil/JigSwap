// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CreateCollectionDialog } from "./create-collection-dialog";

// Creating a collection: Create waits for a name, a taken name is said inline, any other failure
// is toasted, and a new collection opens straight on its Add Puzzles page.

const mocks = vi.hoisted(() => ({
  call: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.call(getFunctionName(ref), args),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      mocks.call(getFunctionName(ref), args),
  }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
// The emoji field's localized names load over the network; not needed here.
vi.mock("@/lib/emoji-label", () => ({ useEmojiLabel: () => null }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const CREATE = getFunctionName(gateway.collections.create);
const LIST = getFunctionName(gateway.collections.listForUser);

const renderDialog = () => {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CreateCollectionDialog open onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
};

const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const createButton = () =>
  screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;

beforeEach(() => {
  mocks.call.mockReset();
  mocks.call.mockImplementation(async (name) =>
    name === CREATE
      ? "col_agg_new"
      : name === LIST
        ? [
            { _id: "col_doc_old", aggregateId: "col_agg_old" },
            { _id: "col_doc_new", aggregateId: "col_agg_new" },
          ]
        : null,
  );
  mocks.push.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("CreateCollectionDialog", () => {
  it("keeps Create disabled until the collection has a name", () => {
    renderDialog();
    expect(createButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(createButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "Cats" } });
    expect(createButton().disabled).toBe(false);
  });

  it("creates the collection and opens its Add Puzzles page", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: " Cats " } });
    fireEvent.click(createButton());

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/collections/col_doc_new/add-puzzles",
      ),
    );
    expect(mocks.call).toHaveBeenCalledWith(
      CREATE,
      expect.objectContaining({ name: "Cats", visibility: "private" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Created “Cats”. Now add some puzzles to it.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still confirms and closes when the new collection's page can't be found", async () => {
    mocks.call.mockImplementation(async (name) =>
      name === CREATE ? "col_agg_new" : [],
    );
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Cats" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("says when to try again after creating too many, and stays open", async () => {
    mocks.call.mockRejectedValue(
      new ConvexError({ code: "RateLimited", retryAfterMs: 3_600_000 }),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Cats" } });
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringMatching(/most collections allowed.*in 1 hour/),
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("says inline when the name is already taken, and stays open", async () => {
    mocks.call.mockRejectedValue(
      new ConvexError({ code: "DuplicateCollectionName", message: "taken" }),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Cats" } });
    fireEvent.click(createButton());

    expect(
      await screen.findByText("You already have a collection called “Cats”."),
    ).toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();

    // Editing the name clears the error.
    fireEvent.change(nameInput(), { target: { value: "Cats 2" } });
    expect(
      screen.queryByText("You already have a collection called “Cats”."),
    ).toBeNull();
  });

  it("toasts any other failure and stays open", async () => {
    mocks.call.mockRejectedValue(new Error("offline"));
    const { onOpenChange } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "Cats" } });
    fireEvent.click(createButton());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't create the collection. Please try again.",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
