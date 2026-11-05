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
import { HouseholdMemberInvite } from "./household-member-invite";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const INVITE = getFunctionName(gateway.household.invite);
const SEARCH = "bo";

const renderInvite = (
  onError: (error: unknown) => void,
  locale: "en" | "nl" = "en",
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
  queryClient.setQueryData(
    convexQuery(gateway.identity.search, { searchTerm: SEARCH }).queryKey,
    [{ _id: "user_bob", name: "Bob" }],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <HouseholdMemberInvite excludedIds={new Set()} onError={onError} />
      </IntlProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: SEARCH },
  });
};

beforeEach(() => {
  mocks.mutation.mockReset();
  vi.mocked(toast.error).mockClear();
});
afterEach(cleanup);

describe("HouseholdMemberInvite errors", () => {
  it.each([
    ["en", "Invite", "You've sent a lot of invites lately. Try again later."],
    [
      "nl",
      "Uitnodigen",
      "Je hebt de laatste tijd veel uitnodigingen verstuurd. Probeer het later opnieuw.",
    ],
  ] as const)(
    "explains a rate-limited invite itself (%s)",
    async (locale, action, message) => {
      mocks.mutation.mockRejectedValue(
        new ConvexError({ code: "RateLimited", retryAfterMs: 60_000 }),
      );
      const onError = vi.fn();
      renderInvite(onError, locale);
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
      expect(mocks.mutation).toHaveBeenCalledWith(INVITE, {
        inviteeId: "user_bob",
      });
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it("hands every other failure to the page's error handler", async () => {
    const error = new ConvexError({ code: "DuplicateInvite", message: "x" });
    mocks.mutation.mockRejectedValue(error);
    const onError = vi.fn();
    renderInvite(onError);
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]?.[0]).toBe(error);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
