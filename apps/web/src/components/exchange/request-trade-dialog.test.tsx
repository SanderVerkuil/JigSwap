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

const renderDialog = (
  requestable: RequestableCopy,
  {
    locale = "en",
    disclosure,
  }: {
    locale?: "en" | "nl";
    disclosure?: { revealsRequester: boolean } | null;
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
      >
        <RequestTradeDialog copy={requestable} onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const submit = (name = "Send request") =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue("exchange_1");
});
afterEach(cleanup);

describe("RequestTradeDialog identity disclosure", () => {
  it("shows the reveal notice (en) and hides the general line when sending reveals the requester", () => {
    renderDialog(copy(), { disclosure: { revealsRequester: true } });
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(
      "Your name and profile will be visible to the owner of this puzzle.",
    );
    expect(note.textContent).toContain(
      "Your profile is private, but the owner needs to know who they're trading with.",
    );
    expect(
      screen.queryByText("The owner will see who sent this request."),
    ).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("shows the reveal notice in Dutch", () => {
    renderDialog(copy(), {
      locale: "nl",
      disclosure: { revealsRequester: true },
    });
    expect(screen.getByRole("note").textContent).toContain(
      "Je naam en profiel worden zichtbaar voor de eigenaar van deze puzzel.",
    );
    expect(
      screen.queryByText("De eigenaar ziet wie deze aanvraag heeft gestuurd."),
    ).toBeNull();
  });

  it.each([
    ["en", "The owner will see who sent this request."],
    ["nl", "De eigenaar ziet wie deze aanvraag heeft gestuurd."],
  ] as const)(
    "shows only the general line when nothing new is revealed (%s)",
    (locale, line) => {
      renderDialog(copy(), {
        locale,
        disclosure: { revealsRequester: false },
      });
      expect(screen.queryByRole("note")).toBeNull();
      expect(screen.getByText(line)).toBeTruthy();
    },
  );

  it("shows neither while the disclosure loads, and holds submit until it has", () => {
    renderDialog(copy());
    expect(screen.queryByRole("note")).toBeNull();
    expect(
      screen.queryByText("The owner will see who sent this request."),
    ).toBeNull();
    expect(submit().disabled).toBe(true);
  });
});

describe("RequestTradeDialog propose", () => {
  it("names the owner as recipient when their id is known", async () => {
    renderDialog(copy(), { disclosure: { revealsRequester: false } });
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
      disclosure: { revealsRequester: true },
    });
    expect(screen.getByText("Owned by Puzzler")).toBeTruthy();
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
    expect(mocks.mutation).toHaveBeenCalledWith(PROPOSE, {
      type: "loan",
      requestedPuzzleId: "copy_1",
    });
  });
});
