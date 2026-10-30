// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { PresenceSettingsView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  signOut: vi.fn<() => Promise<void>>(),
  appearance: undefined as
    { elements?: Record<string, string | undefined> } | undefined,
}));

// A stand-in for Clerk's UserButton: menu items render as plain buttons/links
// (the check icon shows as an svg in the item), custom profile pages render nothing.
vi.mock("@/compat/clerk", () => {
  const UserButton = ({
    children,
    appearance,
  }: {
    children: ReactNode;
    appearance?: typeof mocks.appearance;
  }) => {
    mocks.appearance = appearance;
    return <div>{children}</div>;
  };
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
  // Only the Preferences page renders (as a labelled region); the other custom pages have their own tests.
  UserButton.UserProfilePage = ({
    url,
    label,
    children,
  }: {
    url: string;
    label: string;
    children: ReactNode;
  }) =>
    url === "shell-preferences" ? (
      <section aria-label={label}>{children}</section>
    ) : null;
  return {
    UserButton,
    useUser: () => ({ user: { id: "user_me" } }),
    useClerk: () => ({ signOut: mocks.signOut }),
  };
});

vi.mock("./preferences", () => ({
  useShellPreferences: () => ({
    fullWidth: true,
    hideEmail: true,
    setPreference: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-user-settings", () => ({
  useUserSettings: () => ({
    trackCompletionDuration: false,
    setTrackDuration: vi.fn(),
    shareInProgress: false,
    setShareInProgress: vi.fn(),
  }),
}));

vi.mock("@/components/presence/use-presence", () => ({
  usePresenceSettings: () => mocks.settings,
}));

vi.mock("@/components/whats-new/use-whats-new-state", () => ({
  useWhatsNewUnreadCount: () => 0,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      mocks.mutation(getFunctionName(ref), args),
}));

const SET = getFunctionName(gateway.social.setPresencePreferences);
const UNREGISTER = getFunctionName(gateway.notifications.unregisterPush);

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
  mocks.signOut.mockReset().mockResolvedValue(undefined);
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

  it("offers the three statuses once sharing, marking the current one with a check and in its label", () => {
    mocks.settings = { share: true, override: "away" };
    renderButton();
    const items = statusItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "Status: Automatic",
      "Status: Away (current)",
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
      "Status: Automatisch (huidig)",
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

// This browser holds a push subscription for ENDPOINT; its unsubscribe is recorded in `events`.
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-browser";
const stubPushSubscription = (events: string[]) => {
  const registration = {
    pushManager: {
      getSubscription: async () => ({
        endpoint: ENDPOINT,
        unsubscribe: async () => {
          events.push("unsubscribe");
          return true;
        },
      }),
    },
  };
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      getRegistrations: async () => [registration],
    },
  });
};

describe("ShellUserButton sign out (SEC-54)", () => {
  const events: string[] = [];

  beforeEach(() => {
    events.length = 0;
    mocks.settings = { share: false, override: "auto" };
    stubPushSubscription(events);
    mocks.signOut.mockImplementation(async () => {
      events.push("signOut");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("replaces Clerk's own sign-out, which would skip the push teardown", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "signOut" })).toBeNull();
    // Clerk still renders a default item that isn't re-listed, so its own one is hidden.
    expect(
      mocks.appearance?.elements?.userButtonPopoverActionButton__signOut,
    ).toBe("!hidden");
  });

  it("unsubscribes this browser and unregisters it before signing out", async () => {
    mocks.mutation.mockImplementation(async (name, args) => {
      events.push(`${name} ${JSON.stringify(args)}`);
      return null;
    });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(events).toEqual([
      "unsubscribe",
      `${UNREGISTER} ${JSON.stringify({ endpoint: ENDPOINT })}`,
      "signOut",
    ]);
    // Clerk's default redirect (afterSignOutUrl) applies: no options passed.
    expect(mocks.signOut).toHaveBeenCalledWith();
  });

  it("still signs out when the server unregister fails", async () => {
    mocks.mutation.mockRejectedValue(new Error("offline"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["unsubscribe", "signOut"]);
  });

  it("still signs out, after at most 3 seconds, when the server never answers", async () => {
    vi.useFakeTimers();
    mocks.mutation.mockImplementation(() => new Promise<never>(() => {}));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await vi.advanceTimersByTimeAsync(2999);
    expect(mocks.signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("speaks Dutch", () => {
    renderButton("nl");
    expect(screen.getByRole("button", { name: "Uitloggen" })).toBeTruthy();
  });
});

// UX-56: phones have no top-bar theme or language menus, so the account modal's Preferences page
// opens with both, above the content-width choice.
describe("ShellUserButton Preferences page", () => {
  it("opens with the theme and language choices", () => {
    mocks.settings = undefined;
    renderButton();
    const page = screen.getByRole("region", { name: "Preferences" });
    const groups = Array.from(
      page.querySelectorAll<HTMLElement>("[role=radiogroup]"),
    ).map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["Theme", "Language", "Content Width"]);
  });

  it("speaks Dutch", () => {
    mocks.settings = undefined;
    renderButton("nl");
    const page = screen.getByRole("region", { name: "Voorkeuren" });
    expect(
      Array.from(page.querySelectorAll("[role=radiogroup]")).map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["Thema", "Taal", "Contentbreedte"]);
  });
});
