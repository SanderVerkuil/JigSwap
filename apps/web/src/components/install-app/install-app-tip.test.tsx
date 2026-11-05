// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { InstallAppTip, InstallAppTipView } from "./install-app-tip";
import { clearInstallTipRequest, requestInstallTip } from "./use-install-app";

const mocks = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("@/compat/navigation", () => ({ usePathname: () => mocks.pathname }));

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0";

const wrap = (node: ReactNode, locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "en" ? en : nl}
    timeZone="Europe/Amsterdam"
  >
    {node}
  </IntlProvider>
);

const noop = () => {};

afterEach(() => {
  cleanup();
  mocks.pathname = "/dashboard";
  act(() => clearInstallTipRequest());
});

describe("InstallAppTipView", () => {
  it("starts as one collapsed row: title, How? and a ✕ that snoozes", () => {
    const onSnooze = vi.fn();
    const onNever = vi.fn();
    render(
      wrap(
        <InstallAppTipView
          method="ios"
          onInstall={noop}
          onSnooze={onSnooze}
          onNever={onNever}
        />,
      ),
    );
    expect(
      screen.getByRole("region", { name: "Install JigSwap" }),
    ).toBeTruthy();
    const how = screen.getByRole("button", { name: "How?" });
    expect(how.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Don't show again" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSnooze).toHaveBeenCalledOnce();
    expect(onNever).not.toHaveBeenCalled();
  });

  it("How? expands the steps and offers an explicit Don't show again", () => {
    const onSnooze = vi.fn();
    const onNever = vi.fn();
    render(
      wrap(
        <InstallAppTipView
          method="ios"
          onInstall={noop}
          onSnooze={onSnooze}
          onNever={onNever}
        />,
      ),
    );
    const how = screen.getByRole("button", { name: "How?" });
    fireEvent.click(how);
    expect(how.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(onNever).toHaveBeenCalledOnce();
    expect(onSnooze).not.toHaveBeenCalled();
    fireEvent.click(how);
    expect(how.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("iOS: shows the Share → Add to Home Screen steps and the push note, no install button", () => {
    render(
      wrap(
        <InstallAppTipView
          method="ios"
          defaultExpanded
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toContain("Share");
    expect(steps[1]).toContain("Add to Home Screen");
    expect(screen.getByText(/notifications on iPhone/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install app/ })).toBeNull();
  });

  it("Android: offers Install app, Not now and Don't show again", () => {
    const onInstall = vi.fn();
    const onSnooze = vi.fn();
    const onNever = vi.fn();
    render(
      wrap(
        <InstallAppTipView
          method="prompt"
          defaultExpanded
          onInstall={onInstall}
          onSnooze={onSnooze}
          onNever={onNever}
        />,
      ),
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/Open it like an app/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(onInstall).toHaveBeenCalledOnce();
    expect(onSnooze).toHaveBeenCalledOnce();
    expect(onNever).toHaveBeenCalledOnce();
  });

  it("Android without a prompt: shows Chrome's menu steps, no install button", () => {
    render(
      wrap(
        <InstallAppTipView
          method="android-menu"
          defaultExpanded
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toContain("menu");
    expect(steps[1]).toContain("Add to home screen");
    expect(screen.queryByText(/notifications on iPhone/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Install app/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("Firefox on Android: shows Firefox's menu steps, no install button", () => {
    render(
      wrap(
        <InstallAppTipView
          method="firefox-menu"
          defaultExpanded
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toContain("Firefox");
    expect(steps[1]).toContain("Add app to Home screen");
    expect(screen.queryByText(/notifications on iPhone/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Install app/ })).toBeNull();
  });

  it("Firefox on iOS: shows Firefox's Share step, then Add to Home Screen", () => {
    render(
      wrap(
        <InstallAppTipView
          method="ios-firefox"
          defaultExpanded
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toContain("Firefox's menu");
    expect(steps[1]).toContain("Add to Home Screen");
    expect(screen.queryByRole("button", { name: /Install app/ })).toBeNull();
  });

  it("renders Dutch copy", () => {
    render(
      wrap(
        <InstallAppTipView
          method="ios"
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
        "nl",
      ),
    );
    expect(
      screen.getByRole("region", { name: "JigSwap installeren" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Niet nu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hoe?" }));
    expect(screen.getByText("Zet op beginscherm")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Niet meer tonen" }),
    ).toBeTruthy();
  });
});

describe("InstallAppTip", () => {
  const setUserAgent = (ua: string) =>
    Object.defineProperty(window.navigator, "userAgent", {
      value: ua,
      configurable: true,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (navigator as { getInstalledRelatedApps?: unknown })
      .getInstalledRelatedApps;
  });

  const setInstalledRelatedApps = (apps: unknown[]) =>
    Object.defineProperty(window.navigator, "getInstalledRelatedApps", {
      value: vi.fn(() => Promise.resolve(apps)),
      configurable: true,
    });

  const seenBefore = () =>
    localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1 }));

  it("stays hidden on the first visit", () => {
    setUserAgent(IPHONE_SAFARI);
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("region")).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("jigswap.installTip") ?? "{}").visits,
    ).toBe(1);
  });

  const storedState = () =>
    JSON.parse(localStorage.getItem("jigswap.installTip") ?? "{}") as {
      visits?: number;
      snoozedUntil?: number | null;
      never?: boolean;
    };

  it("iOS: shows collapsed on a later visit and ✕ snoozes it", () => {
    setUserAgent(IPHONE_SAFARI);
    seenBefore();
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("region")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "How?" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(storedState().snoozedUntil).toBeGreaterThan(Date.now());
    expect(storedState().never).toBe(false);
  });

  it("'Don't show again' turns the automatic tip off for good", () => {
    setUserAgent(IPHONE_SAFARI);
    seenBefore();
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByRole("button", { name: "How?" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(storedState().never).toBe(true);
  });

  it.each(["/messages/abc", "/welcome", "/my-puzzles/add/new"])(
    "never shows itself on %s, and leaves the tip for a later page",
    (pathname) => {
      setUserAgent(IPHONE_SAFARI);
      seenBefore();
      mocks.pathname = pathname;
      const { rerender } = render(wrap(<InstallAppTip />));
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole("region")).toBeNull();
      // Not dismissed, not used up for this session.
      expect(storedState()).toEqual({
        visits: 2,
        snoozedUntil: null,
        never: false,
      });
      expect(sessionStorage.getItem("jigswap.installTip.shown")).toBeNull();

      mocks.pathname = "/dashboard";
      rerender(wrap(<InstallAppTip />));
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByRole("region")).toBeTruthy();
    },
  );

  it("steps aside on an open thread and comes back after it", () => {
    setUserAgent(IPHONE_SAFARI);
    seenBefore();
    const { rerender } = render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("region")).toBeTruthy();

    mocks.pathname = "/messages/abc";
    rerender(wrap(<InstallAppTip />));
    expect(screen.queryByRole("region")).toBeNull();
    expect(storedState().snoozedUntil).toBeNull();

    mocks.pathname = "/messages";
    rerender(wrap(<InstallAppTip />));
    expect(screen.getByRole("region")).toBeTruthy();
  });

  it("opens expanded when asked for from the quick sheet, even on a form page", () => {
    setUserAgent(IPHONE_SAFARI);
    mocks.pathname = "/my-puzzles/add/new";
    render(wrap(<InstallAppTip />));
    act(() => requestInstallTip());
    expect(
      screen
        .getByRole("button", { name: "How?" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("stays out of an open thread even when asked for", () => {
    setUserAgent(IPHONE_SAFARI);
    mocks.pathname = "/messages/abc";
    render(wrap(<InstallAppTip />));
    act(() => requestInstallTip());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("Firefox on Android: shows its menu steps without an install button", () => {
    // Firefox has neither beforeinstallprompt nor getInstalledRelatedApps. (Runs before the
    // Chrome tests below, which leave the module-level installed state set.)
    setUserAgent(ANDROID_FIREFOX);
    seenBefore();
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("region")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "How?" }));
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Firefox");
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("Android: appears once beforeinstallprompt fires and calls prompt()", async () => {
    setUserAgent(ANDROID_CHROME);
    seenBefore();
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // No prompt captured yet: an Android browser without one gets nothing.
    expect(screen.queryByRole("region")).toBeNull();

    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    fireEvent.click(screen.getByRole("button", { name: "How?" }));
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("Android Chrome without a prompt: shows the menu steps when JigSwap isn't installed", async () => {
    setUserAgent(ANDROID_CHROME);
    setInstalledRelatedApps([]);
    seenBefore();
    render(wrap(<InstallAppTip />));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("region")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "How?" }));
    expect(screen.getAllByRole("listitem")[1].textContent).toContain(
      "Add to home screen",
    );
  });

  it("Android Chrome without a prompt: stays hidden when JigSwap is already installed", async () => {
    setUserAgent(ANDROID_CHROME);
    setInstalledRelatedApps([{ platform: "webapp" }]);
    seenBefore();
    render(wrap(<InstallAppTip />));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("never shows on desktop widths", () => {
    setUserAgent(IPHONE_SAFARI);
    seenBefore();
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      configurable: true,
    });
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole("region")).toBeNull();
  });
});
