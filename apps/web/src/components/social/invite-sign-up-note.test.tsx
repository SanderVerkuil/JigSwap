import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { InviteSignUpNote } from "./invite-sign-up-note";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const HREF = "/members/hans?invite=abc";

// No network: SSR never runs effects, so the queries only read the seeded cache.
const render = ({
  profile,
  context,
  redirectUrl = HREF,
  locale = "en",
}: {
  profile?: unknown;
  context?: { valid: boolean; kind: "network" | "household" };
  redirectUrl?: unknown;
  locale?: "en" | "nl";
}) => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.social.publicProfile, { handle: "hans" }).queryKey,
    profile,
  );
  queryClient.setQueryData(
    convexQuery(gateway.social.inviteContext, {
      token: "abc",
      memberId: "member_1" as never,
    }).queryKey,
    context,
  );
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <InviteSignUpNote redirectUrl={redirectUrl} />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
  );
};

const PROFILE = {
  locked: true,
  hero: { memberId: "member_1", displayName: "Hans" },
};

describe("InviteSignUpNote", () => {
  it("names the inviter and says what happens after a live network invite", () => {
    const html = render({
      profile: PROFILE,
      context: { valid: true, kind: "network" },
    });
    expect(html).toContain("Hans invited you to JigSwap");
    expect(html).toContain(
      "After you sign up, we&#x27;ll ask whether you two want to follow each other. Nothing happens until you say yes.",
    );
    expect(html).not.toMatch(/request|approv|private/i);
  });

  it("says it in Dutch", () => {
    const html = render({
      profile: PROFILE,
      context: { valid: true, kind: "network" },
      locale: "nl",
    });
    expect(html).toContain("Hans heeft je uitgenodigd voor JigSwap");
    expect(html).toContain(
      "Na het aanmelden vragen we of jullie elkaar willen volgen. Er gebeurt niets tot je ja zegt.",
    );
  });

  it("says a household link leaves the choice to them", () => {
    const html = render({
      profile: PROFILE,
      context: { valid: true, kind: "household" },
    });
    expect(html).toContain("Hans invited you to join their household");
    expect(html).toContain("You&#x27;ll then choose whether to join");
  });

  it("stays quiet for a dead invite: redeeming it would do nothing", () => {
    expect(
      render({ profile: PROFILE, context: { valid: false, kind: "network" } }),
    ).toBe("");
    expect(
      render({
        profile: PROFILE,
        context: { valid: false, kind: "household" },
      }),
    ).toBe("");
  });

  it("stays quiet while loading, for an unknown member and for other sign-ups", () => {
    expect(render({})).toBe("");
    expect(render({ profile: PROFILE })).toBe("");
    expect(render({ profile: null })).toBe("");
    expect(render({ redirectUrl: "/dashboard" })).toBe("");
    expect(render({ redirectUrl: undefined })).toBe("");
  });
});
