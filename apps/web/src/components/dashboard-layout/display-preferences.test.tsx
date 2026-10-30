// @vitest-environment happy-dom
// UX-56: theme and language as segmented radio groups for the places that have no top-bar menus
// (the phone quick sheet and the account modal's Preferences page). The current choice is
// checked, a click applies the choice, and each language is named in its own language.
import type { Locale } from "@/lib/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { LanguageRadios, ThemeRadios } from "./display-preferences";

const mocks = vi.hoisted(() => ({
  theme: "light" as string | undefined,
  setTheme: vi.fn<(theme: string) => void>(),
  changeLocale: vi.fn<(locale: Locale) => Promise<void>>(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));
vi.mock("@/components/ui/language-switcher", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/ui/language-switcher")
  >()),
  useChangeLocale: () => mocks.changeLocale,
}));

beforeEach(() => {
  mocks.theme = "light";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const radios = (locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="Europe/Amsterdam"
  >
    <ThemeRadios />
    <LanguageRadios />
  </IntlProvider>
);

const optionsOf = (group: string) =>
  Array.from(
    screen
      .getByRole("radiogroup", { name: group })
      .querySelectorAll<HTMLElement>("[role=radio]"),
  ).map((radio) => [
    radio.textContent,
    radio.getAttribute("aria-checked"),
    radio.getAttribute("lang"),
  ]);

describe("ThemeRadios", () => {
  it("checks the current theme", () => {
    mocks.theme = "dark";
    render(radios());
    expect(optionsOf("Theme")).toEqual([
      ["Light", "false", null],
      ["Dark", "true", null],
      ["System", "false", null],
    ]);
  });

  it("applies the picked theme", () => {
    render(radios());
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("checks no theme in the server render, where the stored theme is unknown", () => {
    mocks.theme = "dark";
    const html = renderToString(radios());
    const [theme, language] = html.split('<div role="radiogroup"').slice(1);
    expect(theme).toContain('aria-label="Theme"');
    expect(theme).not.toContain('aria-checked="true"');
    // The locale is known on the server, so the language is checked there already.
    expect(language).toContain('aria-checked="true"');
  });
});

describe("LanguageRadios", () => {
  it("checks the current language and names each in its own language", () => {
    render(radios("nl"));
    expect(optionsOf("Taal")).toEqual([
      ["English", "false", "en"],
      ["Nederlands", "true", "nl"],
    ]);
  });

  it("switches to the picked language", () => {
    render(radios());
    fireEvent.click(screen.getByRole("radio", { name: "Nederlands" }));
    expect(mocks.changeLocale).toHaveBeenCalledWith("nl");
  });

  it("draws SVG flags, not emoji", () => {
    render(radios());
    for (const radio of screen
      .getByRole("radiogroup", { name: "Language" })
      .querySelectorAll("[role=radio]")) {
      expect(radio.querySelector("svg[viewBox='0 0 60 45']")).toBeTruthy();
      expect(radio.textContent).not.toMatch(/\p{Regional_Indicator}/u);
    }
  });
});
