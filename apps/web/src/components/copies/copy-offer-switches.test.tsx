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
// backend keeps the owner's own choice), confirms with an Undo toast, and reports failures.

type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
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
const CLOSED = { forTrade: false, forLend: false, forSale: false };

const renderSwitches = (
  props: Partial<Parameters<typeof CopyOfferSwitches>[0]> = {},
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CopyOfferSwitches
          copyId="agg1"
          availability={CLOSED}
          visibilityPreference="visible"
          {...props}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );

const swapSwitch = () => screen.getByRole("switch", { name: "Offer for swap" });
const lendSwitch = () => screen.getByRole("switch", { name: "Offer to lend" });

const lastToast = () => {
  const call = mocks.toastSuccess.mock.calls.at(-1);
  if (!call) throw new Error("no success toast");
  return { message: call[0], options: call[1] ?? {} };
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
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

  it("Undo restores the previous offers, again without a visibility", async () => {
    renderSwitches({ availability: { ...CLOSED, forLend: true } });
    fireEvent.click(lendSwitch());
    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(lastToast().message).toBe("No longer offered to lend");

    lastToast().options.action?.onClick();
    await vi.waitFor(() => expect(mocks.mutation).toHaveBeenCalledTimes(2));
    expect(mocks.mutation.mock.calls[1]).toEqual([
      UPDATE_SHARING,
      { copyId: "agg1", ...CLOSED, forLend: true },
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

  it("a copy without a domain id cannot be changed", () => {
    renderSwitches({ copyId: null });
    expect((swapSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect((lendSwitch() as HTMLButtonElement).disabled).toBe(true);
  });
});
