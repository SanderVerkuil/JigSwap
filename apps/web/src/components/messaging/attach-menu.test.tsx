// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { AttachMenu } from "./attach-menu";

const mocks = vi.hoisted(() => ({ mobile: true }));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile }));

const renderMenu = ({
  locale = "en",
  location = true,
}: { locale?: "en" | "nl"; location?: boolean } = {}) =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <AttachMenu
        photosAvailable
        onPuzzle={() => {}}
        onPhoto={() => {}}
        locationAvailable={location}
        onLocation={() => {}}
      />
    </IntlProvider>,
  );

// The sheet's tiles sit in one grid; its column count follows the options.
const sheetGrid = () =>
  screen.getByRole("button", { name: "Photo" }).parentElement!;

afterEach(() => {
  cleanup();
  mocks.mobile = true;
});

describe("AttachMenu sheet (phones)", () => {
  it("lays three options out in three columns, with the short puzzle label", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    expect(sheetGrid().className).toMatch(/(^| )grid-cols-3( |$)/);
    expect(screen.getByRole("button", { name: "Puzzle" })).toBeTruthy();
    expect(screen.queryByText("Attach a puzzle")).toBeNull();
  });

  it("lays two options out in two columns", () => {
    renderMenu({ location: false });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    expect(sheetGrid().className).toMatch(/(^| )grid-cols-2( |$)/);
  });

  it("uses the short label in Dutch too", () => {
    renderMenu({ locale: "nl" });
    fireEvent.click(screen.getByRole("button", { name: "Bijvoegen" }));

    expect(screen.getByRole("button", { name: "Puzzel" })).toBeTruthy();
    expect(screen.queryByText("Puzzel bijvoegen")).toBeNull();
  });
});

describe("AttachMenu dropdown (desktop)", () => {
  it("keeps the full puzzle label", async () => {
    mocks.mobile = false;
    renderMenu();
    fireEvent.keyDown(screen.getByRole("button", { name: "Attach" }), {
      key: "Enter",
    });

    expect(
      await screen.findByRole("menuitem", { name: "Attach a puzzle" }),
    ).toBeTruthy();
  });
});
