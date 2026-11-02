// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ReplyRevealHint } from "./reply-reveal-hint";

type Disclosure = { revealsYou: boolean } | null;

const renderHint = (
  disclosure: Disclosure | undefined,
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
  if (disclosure !== undefined) {
    queryClient.setQueryData(
      convexQuery(gateway.exchange.replyDisclosure, { exchangeId: "ex-1" })
        .queryKey,
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
        <ReplyRevealHint exchangeId="ex-1" partnerName="Mara" />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("ReplyRevealHint", () => {
  it("tells the owner what a reply shows, and that the email stays private", () => {
    renderHint({ revealsYou: true });
    expect(screen.getByRole("note").textContent).toBe(
      "Replying shows Mara your name, handle and the reviews you've received, for this request only. Your email address stays private.",
    );
  });

  it("speaks Dutch", () => {
    renderHint({ revealsYou: true }, "nl");
    expect(screen.getByRole("note").textContent).toBe(
      "Als je reageert, ziet Mara je naam, gebruikersnaam en de reviews die je hebt gekregen, alleen voor dit verzoek. Je e-mailadres blijft privé.",
    );
  });

  it.each([
    ["a reply reveals nothing new", { revealsYou: false }],
    ["the viewer isn't the owner", null],
    ["the answer is still loading", undefined],
  ] as const)("shows nothing when %s", (_, disclosure) => {
    const { container } = renderHint(disclosure);
    expect(container.textContent).toBe("");
  });
});
