// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CopyOfferSwitches } from "./copy-offer-switches";

// The copy page's offer switches: each flip writes the offers only (never a visibility, so the
// backend keeps the owner's own choice), confirms with an Undo toast that puts back that one offer,
// and reports failures.

type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
  cancel?: { label: string; onClick: () => void };
  classNames?: { toast?: string; cancelButton?: string; actionButton?: string };
};

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string, options?: ToastOptions) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const UPDATE_SHARING = getFunctionName(gateway.library.updateSharing);
const UPDATE_OFFERS = getFunctionName(gateway.library.updateOffers);
const CLOSED = { forTrade: false, forLend: false, forSale: false };

const client = new QueryClient();

const switches = (
  props: Partial<Parameters<typeof CopyOfferSwitches>[0]> = {},
) => (
  <QueryClientProvider client={client}>
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <CopyOfferSwitches
        copyId="agg1"
        availability={CLOSED}
        visibilityPreference="visible"
        {...props}
      />
    </IntlProvider>
  </QueryClientProvider>
);

const renderSwitches = (
  props: Partial<Parameters<typeof CopyOfferSwitches>[0]> = {},
) => render(switches(props));

const swapSwitch = () => screen.getByRole("switch", { name: "Offer for swap" });
const lendSwitch = () => screen.getByRole("switch", { name: "Offer to lend" });

const lastToast = () => {
  const call = mocks.toastSuccess.mock.calls.at(-1);
  if (!call) throw new Error("no success toast");
  return { message: call[0], options: call[1] ?? {} };
};

beforeEach(() => {
  mocks.mutation
    .mockReset()
    .mockResolvedValue({ updated: 1, unchanged: 0, skipped: [] });
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("CopyOfferSwitches", () => {
  it("labels each offer and reflects the current state", () => {
    renderSwitches({ availability: { ...CLOSED, forLend: true } });
    expect(swapSwitch().getAttribute("aria-checked")).toBe("false");
    expect(lendSwitch().getAttribute("aria-checked")).toBe("true");
    expect(swapSwitch().getAttribute("aria-describedby")).toBeTruthy();
  });

  it("turning an offer on sends the offers without a visibility and toasts with Undo", async () => {
    renderSwitches({ availability: { ...CLOSED, forSale: true } });
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

    expect(mocks.mutation).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.mutation.mock.calls[0];
    expect(name).toBe(UPDATE_SHARING);
    expect(args).toEqual({
      copyId: "agg1",
      forTrade: true,
      forLend: false,
      forSale: true,
    });
    expect(args).not.toHaveProperty("visibility");

    const { message, options } = lastToast();
    expect(message).toBe("Offered for swap");
    expect(options.description).toBeUndefined();
    expect(options.action?.label).toBe("Undo");
  });

  it("offers Send a link in the toast when an offer goes on, not when it comes off", async () => {
    const onSendLink = vi.fn();
    renderSwitches({ onSendLink });
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    const { message, options } = lastToast();
    expect(message).toBe("Offered to lend");
    expect(options.action?.label).toBe("Undo");
    expect(options.cancel?.label).toBe(en.copyInstance.sendLink.trigger);
    // Two buttons beside the title squeezed it letter by letter on a Dutch phone.
    expect(options.classNames?.toast).toContain("flex-wrap");
    // Sonner gives each button an auto margin: without this, Send a link floats mid-toast.
    expect(options.classNames?.toast).toContain("justify-end");
    expect(options.classNames?.cancelButton).toContain("!ml-0");
    expect(options.classNames?.actionButton).toContain("!ml-0");
    options.cancel?.onClick();
    expect(onSendLink).toHaveBeenCalled();
    cleanup();

    mocks.toastSuccess.mockReset();
    renderSwitches({ onSendLink, availability: { ...CLOSED, forLend: true } });
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(lastToast().options.cancel).toBeUndefined();
  });

  it("Undo puts back only the offer that changed, again without a visibility", async () => {
    renderSwitches({ availability: { ...CLOSED, forLend: true } });
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(lastToast().message).toBe("No longer offered to lend");

    lastToast().options.action?.onClick();
    await vi.waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(2));
    expect(mocks.mutation.mock.calls[1]).toEqual([
      UPDATE_OFFERS,
      { copyIds: ["agg1"], forLend: true },
    ]);
  });

  it("Undo on an earlier change leaves a later change to another offer alone", async () => {
    const { rerender } = renderSwitches();
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    const swapUndo = lastToast().options.action;

    // The live query reports the first change; then the member switches lend on as well.
    rerender(switches({ availability: { ...CLOSED, forTrade: true } }));
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(2));
    expect(mocks.mutation.mock.calls[1]).toEqual([
      UPDATE_SHARING,
      { copyId: "agg1", ...CLOSED, forTrade: true, forLend: true },
    ]);

    swapUndo?.onClick();
    await vi.waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(3));
    expect(mocks.mutation.mock.calls[2]).toEqual([
      UPDATE_OFFERS,
      { copyIds: ["agg1"], forTrade: false },
    ]);
  });

  it("a private copy's toast says it is visible only while offered", async () => {
    renderSwitches({ visibilityPreference: "private" });
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(lastToast().options.description).toBe(
      "It's visible while it's on offer and private again once you withdraw every offer.",
    );
  });

  it("withdrawing a private copy's last offer says it is private again", async () => {
    renderSwitches({
      availability: { ...CLOSED, forTrade: true },
      visibilityPreference: "private",
    });
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(lastToast().options.description).toBe("It's private again.");
  });

  it("reports a failed change and shows no success toast", async () => {
    mocks.mutation.mockRejectedValueOnce(new Error("nope"));
    renderSwitches();
    fireEvent.click(swapSwitch());
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not save your changes. Please try again.",
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  // Refused while an exchange in progress reserves the copy or it is out on loan.
  it("says the puzzle is held when an offer is refused with CopyReserved", async () => {
    mocks.mutation.mockRejectedValueOnce(
      new ConvexError({ code: "CopyReserved", message: "x" }),
    );
    renderSwitches();
    fireEvent.click(swapSwitch());
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.copyReserved,
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("says the puzzle is held when an Undo is refused with CopyReserved", async () => {
    renderSwitches();
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    mocks.mutation.mockRejectedValueOnce(
      new ConvexError({ code: "CopyReserved", message: "x" }),
    );
    lastToast().options.action?.onClick();
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.copyInstance.editCopy.copyReserved,
      ),
    );
  });

  it("reports a failed Undo", async () => {
    renderSwitches();
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    mocks.mutation.mockRejectedValueOnce(new Error("nope"));
    lastToast().options.action?.onClick();
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not save your changes. Please try again.",
      ),
    );
  });

  it.each([
    ["reserved", en.copyInstance.editCopy.copyReserved],
    ["onLoan", en.copyInstance.editCopy.copyReserved],
    ["notAllowed", "Could not save your changes. Please try again."],
  ])("reports an Undo the server skips as %s", async (reason, message) => {
    renderSwitches({ availability: { ...CLOSED, forTrade: true } });
    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    mocks.mutation.mockResolvedValueOnce({
      updated: 0,
      unchanged: 0,
      skipped: [{ copyId: "agg1", reason }],
    });
    lastToast().options.action?.onClick();
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(message),
    );
  });

  it("an open loan disables both switches and says why", () => {
    renderSwitches({ onLoan: true });
    expect((swapSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((lendSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("It's on loan. You can offer it again once it's back."),
    ).toBeTruthy();
  });

  it("an offer that is on during a loan can be withdrawn, with no Undo to put it back on", async () => {
    renderSwitches({
      availability: { ...CLOSED, forTrade: true },
      onLoan: true,
    });
    expect((swapSwitch() as HTMLButtonElement).disabled).toBe(false);
    expect((lendSwitch() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(swapSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

    expect(mocks.mutation.mock.calls[0]).toEqual([
      UPDATE_SHARING,
      { copyId: "agg1", ...CLOSED },
    ]);
    expect(lastToast().message).toBe("No longer offered for swap");
    expect(lastToast().options.action).toBeUndefined();
  });

  it("shows no sale row on a copy that isn't offered for sale", () => {
    renderSwitches({
      availability: { forTrade: true, forLend: false, forSale: false },
    });
    expect(screen.queryByRole("switch", { name: "Offer for sale" })).toBeNull();
  });

  it("lets a copy on offer for sale be withdrawn from the same place", async () => {
    const availability = { forTrade: false, forLend: false, forSale: true };
    const { rerender } = renderSwitches({ availability });
    const sale = screen.getByRole("switch", { name: "Offer for sale" });
    expect(sale.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sale);
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.mutation).toHaveBeenCalledWith(UPDATE_SHARING, {
      copyId: "agg1",
      forTrade: false,
      forLend: false,
      forSale: false,
    });
    expect(lastToast().message).toBe("No longer offered for sale");

    // The switch the member just used stays where it is, off, so focus has somewhere to be.
    rerender(switches({ availability: CLOSED }));
    expect(
      screen
        .getByRole("switch", { name: "Offer for sale" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    lastToast().options.action?.onClick();
    await vi.waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith(UPDATE_OFFERS, {
        copyIds: ["agg1"],
        forSale: true,
      }),
    );
  });

  it("a copy without a domain id cannot be changed", () => {
    renderSwitches({ copyId: null });
    expect((swapSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((lendSwitch() as HTMLButtonElement).disabled).toBe(true);
  });
});
