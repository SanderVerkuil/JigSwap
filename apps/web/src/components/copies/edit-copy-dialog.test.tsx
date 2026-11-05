// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { EditCopyDialog } from "./edit-copy-dialog";

// The owner's copy editor: the visibility control writes through the same updateSharing call as
// the availability chips, and an offered copy can't be made private.

const calls = vi.hoisted(() => ({
  byMutation: {} as Record<string, Array<Record<string, unknown>>>,
  // A mutation name mapped to the error it rejects with.
  failWith: {} as Record<string, unknown>,
  toastError: vi.fn(),
}));

vi.mock("@/gateway", () => ({
  gateway: {
    library: {
      changeCondition: "changeCondition",
      updateSharing: "updateSharing",
      updateDetails: "updateDetails",
      setCopyCover: "setCopyCover",
    },
  },
}));

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation:
    (name: string) => async (args: Record<string, unknown>) => {
      (calls.byMutation[name] ??= []).push(args);
      if (calls.failWith[name] !== undefined) throw calls.failWith[name];
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: calls.toastError },
}));

const CLOSED = { forTrade: false, forLend: false, forSale: false };

const copyOf = (
  availability: typeof CLOSED,
  visibility: "private" | "visible",
) =>
  ({
    copyId: "row1",
    aggregateId: "agg1",
    gallery: [],
    snapshot: {
      title: "Secret Garden",
      pieceCount: 1000,
      coverImageId: null,
      condition: "good",
      notes: undefined,
      availability,
      visibility,
      tags: [],
    },
  }) as never;

const renderDialog = (copy: never) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <EditCopyDialog open onOpenChange={() => {}} copy={copy} />
    </IntlProvider>,
  );

const radio = (name: string) =>
  screen.getByRole("radio", { name: new RegExp(name) });

const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => {});
};

beforeEach(() => {
  calls.byMutation = {};
  calls.failWith = {};
  calls.toastError.mockReset();
});
afterEach(() => cleanup());

describe("EditCopyDialog visibility", () => {
  it("an offered copy shows Visible and disables Private with the reason", () => {
    renderDialog(copyOf({ ...CLOSED, forTrade: true }, "visible"));
    expect(radio("Visible to the community").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      (radio("Private — only you and your household") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "This copy is on offer, so it is visible. Withdraw the offer to make it private.",
      ),
    ).toBeTruthy();
  });

  it("making a closed copy private sends one updateSharing with visibility private", async () => {
    renderDialog(copyOf(CLOSED, "visible"));
    expect(
      screen.getByText(
        "Offering a puzzle for swap, lend or sale makes it visible.",
      ),
    ).toBeTruthy();
    fireEvent.click(radio("Private — only you and your household"));
    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      { copyId: "agg1", visibility: "private", ...CLOSED },
    ]);
  });

  it("turning on an offer for a private copy switches the form to Visible and saves visible", async () => {
    renderDialog(copyOf(CLOSED, "private"));
    expect(
      radio("Private — only you and your household").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    expect(radio("Visible to the community").getAttribute("aria-checked")).toBe(
      "true",
    );
    await save();
    expect(calls.byMutation.updateSharing).toEqual([
      { copyId: "agg1", visibility: "visible", ...CLOSED, forTrade: true },
    ]);
  });

  it("saving without changes sends no sharing write", async () => {
    renderDialog(copyOf(CLOSED, "private"));
    await save();
    expect(calls.byMutation.updateSharing).toBeUndefined();
  });
});

// The Library refuses a sharing change while the copy is held: an exchange in progress reserves it,
// or it is out on loan (CopyReserved). The member is told why, not just that saving failed.
describe("EditCopyDialog refusals", () => {
  it("says the puzzle is held when the sharing change is refused with CopyReserved", async () => {
    calls.failWith.updateSharing = new ConvexError({
      code: "CopyReserved",
      message: "x",
    });
    renderDialog(copyOf(CLOSED, "visible"));
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    await save();
    await vi.waitFor(() =>
      expect(calls.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.copyReserved,
      ),
    );
  });

  it("keeps the generic message for any other failure", async () => {
    calls.failWith.updateSharing = new Error("boom");
    renderDialog(copyOf(CLOSED, "visible"));
    fireEvent.click(screen.getByRole("button", { name: "For Trade" }));
    await save();
    await vi.waitFor(() =>
      expect(calls.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.editFailed,
      ),
    );
  });

  it("has the message in every locale file", () => {
    for (const messages of [en, nl, source]) {
      expect(messages.copyInstance.editCopy.copyReserved).toEqual(
        expect.any(String),
      );
      expect(messages.puzzles.deleteReserved).toEqual(expect.any(String));
    }
    expect(source.copyInstance.editCopy.copyReserved).toBe(
      en.copyInstance.editCopy.copyReserved,
    );
    expect(source.puzzles.deleteReserved).toBe(en.puzzles.deleteReserved);
  });
});
