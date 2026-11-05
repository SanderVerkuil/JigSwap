// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  RequestTradeDialog,
  type RequestableCopy,
} from "./request-trade-dialog";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const PROPOSE = getFunctionName(gateway.exchange.create);

// A lend-only copy: "Borrow" is the only type and needs no terms, so the form is ready at once.
const copy = (over: Partial<RequestableCopy> = {}): RequestableCopy => ({
  copyId: "copy_1",
  ownerId: "user_owner",
  owner: { name: "Mara" },
  title: "Starry Night",
  availability: { forTrade: false, forSale: false, forLend: true },
  ...over,
});

// The dialog's "today" (IntlProvider `now`), built from local parts: 30 Oct 2026, afternoon.
const NOW = new Date(2026, 9, 30, 15, 30);
const midday = (year: number, month: number, day: number) =>
  new Date(year, month, day, 12).getTime();

const renderDialog = (
  requestable: RequestableCopy,
  {
    locale = "en",
    disclosure,
  }: {
    locale?: "en" | "nl";
    disclosure?: { profilePrivate: boolean } | null;
  } = {},
) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        // Nothing reaches a server: unseeded queries just stay loading.
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  if (disclosure !== undefined) {
    queryClient.setQueryData(
      convexQuery(gateway.exchange.requestDisclosure, {
        requestedPuzzleId: requestable.copyId as never,
      }).queryKey,
      disclosure,
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <RequestTradeDialog copy={requestable} onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const submit = (name = "Send request") =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(toast.success).mockReset();
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue("exchange_1");
});
afterEach(cleanup);

const EN_NOTICE =
  "Your name, handle and the reviews you've received will be visible to the owner of this puzzle, for this request only.";
const NL_NOTICE =
  "Je naam, gebruikersnaam en de reviews die je hebt gekregen worden zichtbaar voor de eigenaar van deze puzzel, alleen voor dit verzoek.";
// Sending a request never shares the email (SEC-08): only the member's own later share does.
const EN_EMAIL =
  "Your email address stays private unless you choose to share it once the owner accepts.";
const NL_EMAIL =
  "Je e-mailadres blijft privé, tenzij je het zelf deelt nadat de eigenaar heeft geaccepteerd.";

describe("RequestTradeDialog identity disclosure", () => {
  it.each([
    ["en", EN_NOTICE, EN_EMAIL, "Your profile itself stays private."],
    ["nl", NL_NOTICE, NL_EMAIL, "Je profiel zelf blijft privé."],
  ] as const)(
    "always shows the trade-card notice and the private email line, plus the private line for a private profile (%s)",
    (locale, notice, emailLine, privateLine) => {
      renderDialog(copy(), { locale, disclosure: { profilePrivate: true } });
      const note = screen.getByRole("note");
      expect(note.textContent).toContain(notice);
      expect(note.textContent).toContain(emailLine);
      expect(note.textContent).toContain(privateLine);
    },
  );

  it.each([
    ["a public profile", { profilePrivate: false }],
    ["a null disclosure", null],
  ] as const)(
    "shows the notice without the private line for %s, and allows submit",
    (_label, disclosure) => {
      renderDialog(copy(), { disclosure });
      const note = screen.getByRole("note");
      expect(note.textContent).toContain(EN_NOTICE);
      expect(note.textContent).toContain(EN_EMAIL);
      expect(note.textContent).not.toContain(
        "Your profile itself stays private.",
      );
      expect(submit().disabled).toBe(false);
    },
  );

  it("shows nothing while the disclosure loads, and holds submit until it has", () => {
    renderDialog(copy());
    expect(screen.queryByRole("note")).toBeNull();
    expect(submit().disabled).toBe(true);
  });
});

describe("RequestTradeDialog propose", () => {
  it("names the owner as recipient when their id is known", async () => {
    renderDialog(copy(), { disclosure: { profilePrivate: false } });
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledWith(PROPOSE, {
      recipientId: "user_owner",
      type: "loan",
      requestedPuzzleId: "copy_1",
    });
  });

  it("omits the recipient for an anonymous owner and names them generically", async () => {
    renderDialog(copy({ ownerId: undefined, owner: null }), {
      disclosure: { profilePrivate: true },
    });
    expect(screen.getByText("Owned by Puzzler")).toBeTruthy();
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledWith(PROPOSE, {
      type: "loan",
      requestedPuzzleId: "copy_1",
    });
  });

  it.each([
    [
      "en",
      "Send request",
      "You've sent a lot of requests lately. Try again later.",
    ],
    [
      "nl",
      "Aanvraag versturen",
      "Je hebt de laatste tijd veel aanvragen verstuurd. Probeer het later opnieuw.",
    ],
  ] as const)(
    "explains a rate-limited request (%s)",
    async (locale, submitLabel, message) => {
      mocks.mutation.mockRejectedValue(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      );
      renderDialog(copy(), { locale, disclosure: { profilePrivate: false } });
      fireEvent.click(submit(submitLabel));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    },
  );
});

describe("RequestTradeDialog success toast", () => {
  // The toast names the kind that was sent, so a borrow is never called a trade.
  it.each([
    ["en", "Send request", "Borrow request sent"],
    ["nl", "Aanvraag versturen", "Leenaanvraag verstuurd"],
  ] as const)(
    "names a borrow as a borrow, not a trade (%s)",
    async (locale, button, message) => {
      renderDialog(copy(), { locale, disclosure: { profilePrivate: false } });
      fireEvent.click(submit(button));
      await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
      expect(toast.success).toHaveBeenCalledWith(message);
    },
  );
});

describe("RequestTradeDialog return-by date", () => {
  // Radix Select opens from the keyboard; the picked option is chosen by its label.
  const choose = async (label: string, option: string) => {
    fireEvent.keyDown(screen.getByRole("combobox", { name: label }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("option", { name: option }));
  };

  it("offers a return-by date only when borrowing", () => {
    renderDialog(
      copy({ availability: { forTrade: true, forSale: true, forLend: false } }),
      { disclosure: null },
    );
    expect(screen.queryByRole("combobox", { name: "Return by" })).toBeNull();
  });

  it("defaults to no fixed date and sends none", async () => {
    renderDialog(copy(), { disclosure: null });
    expect(
      screen.getByRole("combobox", { name: "Return by" }).textContent,
    ).toBe("No fixed date");
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation.mock.calls[0]?.[1]).not.toHaveProperty(
      "loanReturnDate",
    );
  });

  it("sends a preset as a calendar day and says which day it is", async () => {
    renderDialog(copy(), { disclosure: null });
    await choose("Return by", "In 2 weeks");
    expect(screen.getByText("Return by Fri, Nov 13, 2026")).toBeTruthy();
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledWith(PROPOSE, {
      recipientId: "user_owner",
      type: "loan",
      requestedPuzzleId: "copy_1",
      loanReturnDate: midday(2026, 10, 13),
    });
  });

  it("takes a picked date from tomorrow on, holding submit until it's valid", async () => {
    renderDialog(copy(), { disclosure: null });
    await choose("Return by", "Pick a date…");
    const date = screen.getByLabelText("Return date") as HTMLInputElement;
    expect(date.min).toBe("2026-10-31");
    expect(submit().disabled).toBe(true);

    fireEvent.change(date, { target: { value: "2026-10-30" } });
    expect(screen.getByText("Pick a date from tomorrow on.")).toBeTruthy();
    expect(submit().disabled).toBe(true);

    fireEvent.change(date, { target: { value: "2026-11-02" } });
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation.mock.calls[0]?.[1]).toMatchObject({
      type: "loan",
      loanReturnDate: midday(2026, 10, 2),
    });
  });

  it("is translated (nl)", async () => {
    renderDialog(copy(), { locale: "nl", disclosure: null });
    await choose("Uiterlijk terug", "Over 3 weken");
    expect(screen.getByText("Uiterlijk terug op vr 20 nov 2026")).toBeTruthy();
  });
});
