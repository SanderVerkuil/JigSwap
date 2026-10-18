// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { PresenceSettingsView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ShellUserButton } from "./shell-user-button";

const mocks = vi.hoisted(() => ({
  settings: undefined as PresenceSettingsView | undefined,
  mutation: vi.fn<(name: string, args: unknown) => Promise<unknown>>(),
}));

// A stand-in for Clerk's UserButton: menu items render as plain buttons/links
// (the check icon shows as an svg in the item), custom profile pages render nothing.
vi.mock("@/compat/clerk", () => {
  const UserButton = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  UserButton.MenuItems = ({ children }: { children: ReactNode }) => (
    <ul>{children}</ul>
  );
  UserButton.Link = ({ label }: { label: string }) => (
    <li>
      <a href="#">{label}</a>
    </li>
  );
  UserButton.Action = ({
    label,
    labelIcon,
    onClick,
  }: {
    label: string;
    labelIcon?: ReactNode;
    onClick?: () => void;
  }) => (
    <li>
      <button type="button" onClick={onClick}>
        {labelIcon}
        {label}
      </button>
    </li>
  );
  UserButton.UserProfilePage = () => null;
  return { UserButton, useUser: () => ({ user: { id: "user_me" } }) };
});

vi.mock("@/components/presence/use-presence", () => ({
  usePresenceSettings: () => mocks.settings,
}));

vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewUnreadCount: () => 0,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const SET = getFunctionName(gateway.social.setPresencePreferences);

const renderButton = (locale: "en" | "nl" = "en") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <ShellUserButton />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

const statusItems = () =>
  screen.queryAllByRole("button", { name: /^Status: / });

describe("ShellUserButton status menu", () => {
  it.each<[string, PresenceSettingsView | undefined]>([
    ["settings are loading", undefined],
    ["sharing was never chosen", { share: null, override: "auto" }],
    ["the member doesn't share", { share: false, override: "away" }],
  ])("is hidden while %s, with no own dot", (_label, settings) => {
    mocks.settings = settings;
    const { container } = renderButton();
    expect(statusItems()).toEqual([]);
    expect(container.querySelector("[data-presence]")).toBeNull();
    // The rest of the menu is still there.
    expect(screen.getByRole("button", { name: "manageAccount" })).toBeTruthy();
  });

  it("offers the three statuses once sharing, with a check on the current one", () => {
    mocks.settings = { share: true, override: "away" };
    renderButton();
    const items = statusItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "Status: Automatic",
      "Status: Away",
      "Status: Appear offline",
    ]);
    expect(items.map((item) => item.querySelector("svg") !== null)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("sets the chosen override", () => {
    mocks.settings = { share: true, override: "auto" };
    renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: "Status: Appear offline" }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(SET, { override: "invisible" });
  });

  it("speaks Dutch", () => {
    mocks.settings = { share: true, override: "auto" };
    renderButton("nl");
    expect(statusItems().map((item) => item.textContent)).toEqual([
      "Status: Automatisch",
      "Status: Afwezig",
      "Status: Offline weergeven",
    ]);
  });

  it.each<[PresenceSettingsView["override"], string | null]>([
    ["auto", "online"],
    ["away", "away"],
    ["invisible", null],
  ])("shows the member's own dot for %s as %s", (override, dot) => {
    mocks.settings = { share: true, override };
    const { container } = renderButton();
    expect(
      container.querySelector<HTMLElement>("[data-presence]")?.dataset
        .presence ?? null,
    ).toBe(dot);
  });
});
