// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
// UX-158: the search hint names the palette shortcut of the platform it runs on, only after mount,
// and not on a touch screen (no keyboard to press it with).
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./index";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "user_1" } }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/gateway", () => ({
  gateway: {
    identity: { byClerkId: "byClerkId" },
    library: { ownedByOwner: "ownedByOwner" },
    household: { copies: "householdCopies", mine: "householdMine" },
    lending: { lentOut: "lentOut", recallLoan: "recallLoan" },
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (name: string) => ({ name }),
  useConvexMutation: () => vi.fn(),
}));
// A signed-in member with no copies yet and no household.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data:
      name === "byClerkId"
        ? { _id: "member_1" }
        : name === "householdMine"
          ? null
          : [],
    isPending: false,
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/library/copy-card-actions", () => ({
  useCopyCardActions: () => ({ cardActions: () => [], dialogs: null }),
  useSolveStateByCopyId: () => new Map(),
}));
vi.mock("@/lib/member-display-name", () => ({
  useMemberDisplayName: () => () => "",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = (locale: "en" | "nl" = "en") => {
  const PuzzlesPage = Route.options.component as ComponentType;
  return (
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <PuzzlesPage />
    </IntlProvider>
  );
};

function stubPlatform(platform: string) {
  vi.stubGlobal("navigator", {
    ...navigator,
    platform,
    userAgentData: undefined,
  });
}

describe("My Puzzles search hint", () => {
  it.each([
    ["MacIntel", "Press ⌘K to search puzzles, people and more"],
    ["Linux x86_64", "Press Ctrl K to search puzzles, people and more"],
  ])("names the %s shortcut", (platform, hint) => {
    stubPlatform(platform);
    render(page());
    expect(screen.getByText(hint).className).toContain("pointer-coarse:hidden");
  });

  it("speaks Dutch", () => {
    stubPlatform("Win32");
    render(page("nl"));
    expect(
      screen.getByText("Druk op Ctrl K om puzzels, mensen en meer te zoeken"),
    ).toBeTruthy();
  });

  it("renders no hint on the server, where the platform is unknown", () => {
    const html = renderToString(page());
    expect(html).toContain("0 of 0 puzzles");
    expect(html).not.toContain("search puzzles, people");
  });
});
