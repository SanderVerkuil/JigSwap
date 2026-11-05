// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ExchangeActions, type ActionableExchange } from "./exchange-actions";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const ACCEPT = getFunctionName(gateway.exchange.accept);
const DECLINE = getFunctionName(gateway.exchange.decline);
const CANCEL = getFunctionName(gateway.exchange.cancel);
const COMPLETE = getFunctionName(gateway.exchange.complete);

const EXCHANGE = "exchange-1";
const NOW = Date.UTC(2026, 9, 30, 12);
const HOUR = 3_600_000;

const exchange = (
  fields: Partial<ActionableExchange> = {},
): ActionableExchange => ({
  aggregateId: EXCHANGE,
  status: "proposed",
  type: "trade",
  ...fields,
});

const renderActions = ({
  fields,
  direction = "incoming",
  locale = "en",
}: {
  fields?: Partial<ActionableExchange>;
  direction?: "incoming" | "outgoing";
  locale?: "en" | "nl";
} = {}) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={new Date(NOW)}
      >
        <ExchangeActions
          exchange={exchange(fields)}
          direction={direction}
          partnerName="Anna"
          requestedTitle="Harbour Lights"
          offeredTitle="Tulip Fields"
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const button = (name: string | RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

// A mutation that stays in flight until the test resolves it.
const deferred = () => {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});
afterEach(cleanup);

describe("ExchangeActions: accept", () => {
  it("disables both actions and says it is accepting while the request runs", async () => {
    const pending = deferred();
    mocks.mutation.mockReturnValue(pending.promise);
    renderActions();

    fireEvent.click(button("Accept"));

    await waitFor(() => expect(button("Accepting…").disabled).toBe(true));
    expect(button("Decline").disabled).toBe(true);
    expect(mocks.mutation).toHaveBeenCalledWith(ACCEPT, {
      exchangeId: EXCHANGE,
    });

    pending.resolve(null);
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Request accepted. Arrange the handover with Anna.",
      ),
    );
    expect(button("Accept").disabled).toBe(false);
  });

  it("says why an accept was refused", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "NotPermittedInCircle", message: "x" }),
    );
    renderActions();
    fireEvent.click(button("Accept"));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.trades.errors.NotPermittedInCircle,
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for an unexpected failure", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderActions();
    fireEvent.click(button("Accept"));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Something went wrong. Please try again.",
      ),
    );
  });

  it("can't act on a legacy row without an aggregate id", () => {
    renderActions({ fields: { aggregateId: undefined } });
    expect(button("Accept").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(true);
  });
});

describe("ExchangeActions: decline", () => {
  it("asks first and only declines once confirmed", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderActions();

    fireEvent.click(button("Decline"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Decline this request?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Anna gets a notification that you declined. You can't undo this, but they can send a new request.",
      ),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Request declined"),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(DECLINE, {
      exchangeId: EXCHANGE,
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does nothing when the member backs out", () => {
    renderActions();
    fireEvent.click(button("Decline"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and explains a refusal", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "IllegalTransition", message: "x" }),
    );
    renderActions();
    fireEvent.click(button("Decline"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Decline",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "This exchange has changed in the meantime. Check its current status.",
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("ExchangeActions: cancel", () => {
  it("offers the sender Cancel only, behind a confirm with a keep option", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderActions({ direction: "outgoing" });
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();

    fireEvent.click(button("Cancel"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cancel your request?")).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep request" }),
    );
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(button("Cancel"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel request",
      }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Request cancelled"),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(CANCEL, {
      exchangeId: EXCHANGE,
    });
  });
});

describe("ExchangeActions: cancel an accepted exchange", () => {
  it.each(["incoming", "outgoing"] as const)(
    "lets the %s member call it off once they confirm the consequence",
    async (direction) => {
      mocks.mutation.mockResolvedValue(null);
      renderActions({ fields: { status: "accepted" }, direction });

      fireEvent.click(button("Cancel"));
      const dialog = screen.getByRole("alertdialog");
      expect(
        within(dialog).getByText(en.trades.cancelAccepted.body),
      ).toBeTruthy();
      expect(mocks.mutation).not.toHaveBeenCalled();

      fireEvent.click(
        within(dialog).getByRole("button", {
          name: en.trades.cancelAccepted.confirm,
        }),
      );
      await waitFor(() =>
        expect(mocks.toastSuccess).toHaveBeenCalledWith(
          en.trades.toast.cancelledAccepted,
        ),
      );
      expect(mocks.mutation).toHaveBeenCalledWith(CANCEL, {
        exchangeId: EXCHANGE,
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
    },
  );

  it("still lets a member who already confirmed call it off", () => {
    renderActions({
      fields: {
        status: "accepted",
        recipientConfirmationTimestamp: NOW - HOUR,
      },
      direction: "incoming",
    });
    expect(screen.queryByRole("button", { name: "Mark Complete" })).toBeNull();
    expect(button("Cancel").disabled).toBe(false);
  });

  it("keeps the dialog open and explains a refusal", async () => {
    mocks.mutation.mockRejectedValue(
      new ConvexError({ code: "WrongParty", message: "x" }),
    );
    renderActions({ fields: { status: "accepted" } });
    fireEvent.click(button("Cancel"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: en.trades.cancelAccepted.confirm,
      }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        en.trades.errors.WrongParty,
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows the pending label while the cancel runs", async () => {
    const pending = deferred();
    mocks.mutation.mockReturnValue(pending.promise);
    renderActions({ fields: { status: "accepted" } });
    fireEvent.click(button("Cancel"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: en.trades.cancelAccepted.confirm,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("alertdialog")).getByRole<HTMLButtonElement>(
          "button",
          { name: "Cancelling…" },
        ).disabled,
      ).toBe(true),
    );
    pending.resolve(null);
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
  });
});

describe("ExchangeActions: complete", () => {
  const completeDialog = () => {
    fireEvent.click(button("Mark Complete"));
    return screen.getByRole("alertdialog");
  };

  it("asks first, and says the partner still has to confirm", async () => {
    mocks.mutation.mockResolvedValue(null);
    // The requester of a swap nobody has confirmed yet.
    renderActions({ fields: { status: "accepted" }, direction: "outgoing" });
    expect(screen.queryByText("Your turn")).toBeNull();

    const dialog = completeDialog();
    expect(within(dialog).getByText("Confirm the handover?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Only confirm once the puzzle has changed hands. The exchange completes as soon as Anna confirms too. Completion moves “Tulip Fields” to Anna's library and “Harbour Lights” to yours. This can't be undone.",
      ),
    ).toBeTruthy();
    expect(mocks.mutation).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm handover" }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Confirmed. Waiting for Anna.",
      ),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(COMPLETE, {
      exchangeId: EXCHANGE,
    });
  });

  it("shows the owner it's their turn when only the buyer has confirmed, and that their click settles", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderActions({
      fields: {
        status: "accepted",
        type: "sale",
        initiatorConfirmationTimestamp: NOW - 2 * HOUR,
      },
      direction: "incoming",
    });
    expect(screen.getByText("Your turn")).toBeTruthy();
    expect(screen.getByText("Anna confirmed 2 hours ago")).toBeTruthy();

    const dialog = completeDialog();
    expect(
      within(dialog).getByText(
        "Anna has already confirmed, so your confirmation completes the exchange. Completion moves “Harbour Lights” to Anna's library. This can't be undone.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm handover" }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Exchange completed"),
    );
  });

  it("words a loan as starting the loan, not as a permanent move", async () => {
    mocks.mutation.mockResolvedValue(null);
    renderActions({
      fields: {
        status: "accepted",
        type: "loan",
        recipientConfirmationTimestamp: NOW - HOUR,
      },
      direction: "outgoing",
    });
    const dialog = completeDialog();
    expect(
      within(dialog).getByText(
        "Anna has already confirmed, so your confirmation completes the exchange. Completion starts the loan: you hold “Harbour Lights” until you return it to Anna.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm handover" }),
    );
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Loan started"),
    );
  });

  it("replaces the button with who it is waiting for once the viewer has confirmed", () => {
    renderActions({
      fields: {
        status: "accepted",
        recipientConfirmationTimestamp: NOW - 3 * HOUR,
      },
      direction: "incoming",
    });
    expect(
      screen.getByText("You confirmed 3 hours ago · Waiting for Anna"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark Complete" })).toBeNull();
    expect(screen.queryByText("Your turn")).toBeNull();
  });

  it("never says the viewer confirmed in the future, however far the minute clock lags", () => {
    // A confirmation made just now is ahead of a clock that only ticks once a minute.
    renderActions({
      direction: "outgoing",
      fields: {
        status: "accepted",
        initiatorConfirmationTimestamp: NOW + 30_000,
      },
    });
    expect(
      screen.getByText("You confirmed now · Waiting for Anna"),
    ).toBeTruthy();
  });

  it("keeps the confirm open with a pending label while it runs", async () => {
    mocks.mutation.mockReturnValue(new Promise(() => {}));
    renderActions({ fields: { status: "accepted" } });
    const dialog = completeDialog();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm handover" }),
    );
    await waitFor(() =>
      expect(
        (
          within(screen.getByRole("alertdialog")).getByRole("button", {
            name: "Confirming…",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });

  it("says why a completion was refused: a puzzle is set aside elsewhere or changed hands", async () => {
    for (const [code, message] of [
      ["CopyReserved", en.trades.errors.copyReserved],
      ["RecipientNotOwner", en.trades.errors.copyChangedHands],
    ] as const) {
      mocks.toastError.mockReset();
      mocks.mutation.mockRejectedValue(new ConvexError({ code, message: "x" }));
      renderActions({ fields: { status: "accepted" } });
      fireEvent.click(
        within(completeDialog()).getByRole("button", {
          name: "Confirm handover",
        }),
      );
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(message),
      );
      cleanup();
    }
  });

  it("offers no lifecycle action once the exchange is closed", () => {
    for (const status of ["completed", "rejected", "cancelled"] as const) {
      renderActions({ fields: { status } });
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      cleanup();
    }
  });
});

describe("ExchangeActions: Dutch", () => {
  it("says who confirmed and words the handover in Dutch", () => {
    renderActions({
      locale: "nl",
      fields: {
        status: "accepted",
        type: "loan",
        initiatorConfirmationTimestamp: NOW - 2 * HOUR,
      },
    });
    expect(screen.getByText("Jouw beurt")).toBeTruthy();
    expect(screen.getByText("Anna heeft 2 uur geleden bevestigd")).toBeTruthy();
    fireEvent.click(button("Markeren als voltooid"));
    expect(
      screen.getByText(
        "Anna heeft al bevestigd, dus met jouw bevestiging is de uitwisseling afgerond. Bij afronding gaat de lening in: Anna houdt “Harbour Lights” tot die wordt teruggegeven, en de puzzel blijft in je bibliotheek.",
      ),
    ).toBeTruthy();
  });

  it("labels the actions and the confirm in Dutch", () => {
    renderActions({ locale: "nl" });
    expect(button("Accepteren")).toBeTruthy();
    fireEvent.click(button("Afwijzen"));
    expect(screen.getByText("Dit verzoek afwijzen?")).toBeTruthy();
    expect(
      screen.getByText(
        "Anna krijgt een melding dat je het verzoek hebt afgewezen. Dit kun je niet ongedaan maken, maar een nieuw verzoek sturen kan wel.",
      ),
    ).toBeTruthy();
  });
});
