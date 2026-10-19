// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { TradePartnerView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { TradePartnerCard } from "./trade-partner-card";

// Router-free links: the test asserts the card's DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: { handle: string };
    children?: ReactNode;
  }) => (
    <a href={to.replace("$handle", params?.handle ?? "")} {...rest}>
      {children}
    </a>
  ),
}));

const revealed = (
  over: Partial<Extract<TradePartnerView, { state: "revealed" }>> = {},
): TradePartnerView => ({
  state: "revealed",
  memberId: "user_mara",
  name: "Mara",
  username: "mara",
  email: "mara@example.test",
  profileViewable: false,
  reviews: {
    averageRating: 4.5,
    totalReviews: 2,
    items: [
      {
        rating: 5,
        comment: "Lovely puzzle",
        createdAt: Date.UTC(2026, 0, 2),
        reviewerName: "Sam",
      },
      { rating: 4, createdAt: Date.UTC(2026, 0, 1) },
    ],
  },
  ...over,
});

const renderCard = (
  partner: TradePartnerView | null | undefined,
  {
    locale = "en",
    viewerIsRequester = true,
  }: { locale?: "en" | "nl"; viewerIsRequester?: boolean } = {},
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
  if (partner !== undefined) {
    queryClient.setQueryData(
      convexQuery(gateway.exchange.tradePartner, {
        exchangeId: "exchange_1" as never,
      }).queryKey,
      partner,
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <TradePartnerCard
          exchangeId="exchange_1"
          label="To"
          viewerIsRequester={viewerIsRequester}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("TradePartnerCard", () => {
  it("shows a revealed partner's trade card: name, handle, email, rating and reviews", () => {
    const { container } = renderCard(revealed());
    expect(screen.getByText("Mara")).toBeTruthy();
    expect(screen.getByText("@mara")).toBeTruthy();
    const mail = screen.getByRole("link", { name: "mara@example.test" });
    expect(mail.getAttribute("href")).toBe("mailto:mara@example.test");
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(container.textContent).toContain("(2 reviews)");
    expect(screen.getByText("Lovely puzzle")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    // An anonymous reviewer gets the generic label.
    expect(container.textContent).toContain("Puzzler ·");
  });

  it("omits the email when the viewer may not see it", () => {
    renderCard(revealed({ email: undefined }));
    expect(screen.queryByText(/@example\.test/)).toBeNull();
    expect(screen.getByText("Mara")).toBeTruthy();
  });

  it("links the profile only when it is viewable", () => {
    renderCard(revealed({ profileViewable: true }));
    expect(
      screen.getByRole("link", { name: "Mara" }).getAttribute("href"),
    ).toBe("/members/mara");
    cleanup();
    renderCard(revealed({ profileViewable: false }));
    expect(screen.queryByRole("link", { name: "Mara" })).toBeNull();
  });

  it.each([
    ["en", "Puzzler", "Their details appear once they accept or reply."],
    [
      "nl",
      "Puzzelaar",
      "Hun gegevens verschijnen zodra ze accepteren of reageren.",
    ],
  ] as const)(
    "names a hidden partner generically with a note for the requester (%s)",
    (locale, label, note) => {
      renderCard({ state: "hidden" }, { locale });
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(note)).toBeTruthy();
    },
  );

  it("shows no hidden-partner note to the owner", () => {
    renderCard({ state: "hidden" }, { viewerIsRequester: false });
    expect(
      screen.queryByText("Their details appear once they accept or reply."),
    ).toBeNull();
  });

  it("names a departed partner 'Deleted member'", () => {
    renderCard({ state: "departed" });
    expect(screen.getByText("Deleted member")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names a departed reviewer 'Deleted member'", () => {
    const { container } = renderCard(
      revealed({
        reviews: {
          averageRating: 5,
          totalReviews: 1,
          items: [
            {
              rating: 5,
              createdAt: Date.UTC(2026, 0, 2),
              reviewerDeparted: true,
            },
          ],
        },
      }),
    );
    expect(container.querySelector("li")?.textContent).toContain(
      "Deleted member ·",
    );
  });

  it("renders no card while loading or for a non-party", () => {
    const { container } = renderCard(undefined);
    expect(container.querySelector("[data-slot=card]")).toBeNull();
    cleanup();
    const empty = renderCard(null);
    expect(empty.container.textContent).toBe("");
  });
});
