// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { EditCopyDialog } from "./edit-copy-dialog";

// The owner's copy editor: the visibility control writes through the same updateSharing call as
// the availability chips, and an offered copy can't be made private.

const calls = vi.hoisted(() => ({
  byMutation: {} as Record<string, Array<Record<string, unknown>>>,
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
    },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (args: unknown) => Promise<unknown>;
  }) => ({ mutateAsync: mutationFn, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
