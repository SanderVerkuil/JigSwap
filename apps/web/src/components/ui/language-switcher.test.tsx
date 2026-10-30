// @vitest-environment happy-dom
// UX-57: the language menu marks the current language as a checked radio (not only with the
// focus-style background), names each language in its own language (lang attribute), draws SVG
// flags instead of emoji (which render as letter pairs on Windows), and names its trigger with the
// current language.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LanguageSwitcher } from "./language-switcher";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  setLocale: vi.fn<(args: { data: string }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  setLocale: (args: { data: string }) => {
    mocks.calls.push(`setLocale:${args.data}`);
    return mocks.setLocale(args);
  },
  clearIntlCache: () => mocks.calls.push("clearIntlCache"),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    invalidate: () => {
      mocks.calls.push("invalidate");
      return mocks.invalidate();
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.calls.length = 0;
});

const renderSwitcher = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <LanguageSwitcher />
    </IntlProvider>,
  );

async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findAllByRole("menuitemradio");
}

describe("LanguageSwitcher", () => {
  it("names the trigger with the current language", () => {
    renderSwitcher();
    expect(
      screen.getByRole("button", { name: "Switch language: English" }),
    ).toBeTruthy();
  });

  it("names the trigger in Dutch with one wording for the switch", () => {
    renderSwitcher("nl");
    expect(
      screen.getByRole("button", { name: "Taal wijzigen: Nederlands" }),
    ).toBeTruthy();
  });

  it("checks the current language and tags each name with its language", async () => {
    renderSwitcher("nl");
    const items = await openMenu("Taal wijzigen: Nederlands");
    expect(
      items.map((item) => [
        item.textContent,
        item.getAttribute("aria-checked"),
        item.getAttribute("lang"),
      ]),
    ).toEqual([
      ["English", "false", "en"],
      ["Nederlands", "true", "nl"],
    ]);
  });

  it("draws SVG flags, not emoji", async () => {
    renderSwitcher();
    const items = await openMenu("Switch language: English");
    for (const item of items) {
      expect(item.textContent).not.toMatch(/\p{Regional_Indicator}/u);
      expect(item.querySelector("svg[viewBox='0 0 60 45']")).toBeTruthy();
    }
  });

  it("switches the catalog: stores the locale, drops the cache, reloads, confirms", async () => {
    mocks.setLocale.mockResolvedValue({ locale: "nl" });
    mocks.invalidate.mockResolvedValue();
    renderSwitcher();
    await openMenu("Switch language: English");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Nederlands" }));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.calls).toEqual([
      "setLocale:nl",
      "clearIntlCache",
      "invalidate",
    ]);
  });

  it("does nothing when the current language is picked again", async () => {
    renderSwitcher();
    await openMenu("Switch language: English");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "English" }));
    await Promise.resolve();
    expect(mocks.calls).toEqual([]);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
