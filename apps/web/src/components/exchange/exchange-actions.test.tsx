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

const exchange = (
  fields: Partial<ActionableExchange> = {},
): ActionableExchange => ({
  aggregateId: EXCHANGE,
  status: "proposed",
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
      >
        <ExchangeActions
          exchange={exchange(fields)}
          direction={direction}
          partnerName="Anna"
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
  it("confirms completion with a pending label and a toast", async () => {
    const pending = deferred();
    mocks.mutation.mockReturnValue(pending.promise);
    renderActions({ fields: { status: "accepted" } });

    fireEvent.click(button("Mark Complete"));
    await waitFor(() => expect(button("Confirming…").disabled).toBe(true));
    expect(mocks.mutation).toHaveBeenCalledWith(COMPLETE, {
      exchangeId: EXCHANGE,
    });

    pending.resolve(null);
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Handover confirmed"),
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
      fireEvent.click(button("Mark Complete"));
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
