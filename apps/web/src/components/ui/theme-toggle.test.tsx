// @vitest-environment happy-dom
// UX-57: the theme menu marks the current theme as a checked radio and names its trigger with it.
// next-themes only knows the stored theme in the browser, so the server render names no theme
// (the first client render must match it).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ModeToggle } from "./theme-toggle";

const mocks = vi.hoisted(() => ({
  theme: "dark" as string | undefined,
  setTheme: vi.fn<(theme: string) => void>(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));

beforeEach(() => {
  mocks.theme = "dark";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const toggle = (locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="Europe/Amsterdam"
  >
    <ModeToggle />
  </IntlProvider>
);

async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findAllByRole("menuitemradio");
}

describe("ModeToggle", () => {
  it("names the trigger with the current theme", () => {
    render(toggle());
    expect(
      screen.getByRole("button", { name: "Toggle theme: Dark" }),
    ).toBeTruthy();
  });

  it("names the trigger in Dutch", () => {
    mocks.theme = "system";
    render(toggle("nl"));
    expect(
      screen.getByRole("button", { name: "Thema wisselen: Systeem" }),
    ).toBeTruthy();
  });

  it("names no theme in the server render", () => {
    const html = renderToString(toggle());
    expect(html).toContain("Toggle theme");
    expect(html).not.toContain("Toggle theme: ");
  });

  it("checks the current theme", async () => {
    render(toggle());
    const items = await openMenu("Toggle theme: Dark");
    expect(
      items.map((item) => [
        item.textContent,
        item.getAttribute("aria-checked"),
      ]),
    ).toEqual([
      ["Light", "false"],
      ["Dark", "true"],
      ["System", "false"],
    ]);
  });

  it("applies the picked theme", async () => {
    render(toggle());
    await openMenu("Toggle theme: Dark");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "System" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("system");
  });
});
