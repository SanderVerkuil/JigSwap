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

vi.mock("@/compat/navigation", () => ({ usePathname: () => "/dashboard" }));

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
});

describe("InstallAppTipView", () => {
  it("iOS: shows the Share → Add to Home Screen steps and the push note, no install button", () => {
    render(
      wrap(
        <InstallAppTipView
          method="ios"
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    expect(
      screen.getByRole("region", { name: "Add JigSwap to your home screen" }),
    ).toBeTruthy();
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
          onInstall={onInstall}
          onSnooze={onSnooze}
          onNever={onNever}
        />,
      ),
    );
    expect(screen.queryByRole("list")).toBeNull();
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
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
  });

  it("Firefox on iOS: shows Firefox's Share step, then Add to Home Screen", () => {
    render(
      wrap(
        <InstallAppTipView
          method="ios-firefox"
          onInstall={noop}
          onSnooze={noop}
          onNever={noop}
        />,
      ),
    );
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps[0]).toContain("Firefox's menu");
    expect(steps[1]).toContain("Add to Home Screen");
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
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
      screen.getByRole("region", { name: "Zet JigSwap op je beginscherm" }),
    ).toBeTruthy();
    expect(screen.getByText("Zet op beginscherm")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Niet nu" })).toBeTruthy();
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

  it("iOS: shows on a later visit and 'Not now' snoozes it", () => {
    setUserAgent(IPHONE_SAFARI);
    seenBefore();
    render(wrap(<InstallAppTip />));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("region")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region")).toBeNull();
    const state = JSON.parse(localStorage.getItem("jigswap.installTip") ?? "");
    expect(state.snoozedUntil).toBeGreaterThan(Date.now());
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
