// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { AddPuzzleLayout } from "./add-puzzle-layout";
import { AddPuzzleSummary, LivePreviewCard } from "./live-preview-card";

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => (
  <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
    {children}
  </IntlProvider>
);

const preview = (props: Partial<Parameters<typeof LivePreviewCard>[0]> = {}) =>
  render(
    <LivePreviewCard
      title="Harbour at dusk"
      brand="Ravensburger"
      pieceCount={1000}
      available={false}
      {...props}
    />,
    { wrapper },
  );

const classes = (el: Element | null) =>
  el?.getAttribute("class")?.split(/\s+/) ?? [];

// The contribute preview promises "how it will look in the catalogue": it is the catalogue card's
// shell, with the title under the cover, not white text on a scrim over a photo-less tile.
describe("LivePreviewCard", () => {
  it("is the catalogue card, with title and brand under the cover", () => {
    const { container } = preview();
    const card = container.querySelector("[data-slot='card']");
    expect(card).not.toBeNull();
    const title = screen.getByRole("heading", { name: "Harbour at dusk" });
    // One level under the page's h1, as the copy preview.
    expect(title.tagName).toBe("H2");
    const cover = card!.firstElementChild!;
    expect(cover.contains(title)).toBe(false);
    expect(
      cover.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Ravensburger")).toBeTruthy();
    expect(screen.getByText("1,000 pieces")).toBeTruthy();
  });

  it("draws no scrim and no white title", () => {
    const { container } = preview();
    const html = container.innerHTML;
    expect(html).not.toMatch(/from-black|text-white/);
  });

  it("has no link and no actions: there is no puzzle yet", () => {
    preview();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the title placeholder in muted text until a title is typed", () => {
    const { container, rerender } = preview({ title: "", brand: "" });
    const card = container.querySelector("[data-slot='card']");
    expect(
      screen.getByRole("heading", { name: en.puzzles.previewTitlePlaceholder }),
    ).toBeTruthy();
    expect(classes(card)).toContain("[&_h2]:text-muted-foreground");

    rerender(
      <LivePreviewCard
        title="Harbour at dusk"
        brand=""
        pieceCount={undefined}
        available={false}
      />,
    );
    expect(classes(card)).not.toContain("[&_h2]:text-muted-foreground");
  });

  it("puts the available badge with the card's badges, not on the cover", () => {
    const { container } = preview({ available: true });
    const badge = screen.getByText(en.puzzles.previewAvailable);
    const cover =
      container.querySelector("[data-slot='card']")!.firstElementChild!;
    expect(cover.contains(badge)).toBe(false);
  });
});

// At lg, with the sidebar open, a 332px preview column crushed the form fields: the preview shows
// beside the form only from xl, and the one-row recap stands in for it up to exactly there.
describe("the preview's breakpoint", () => {
  it("shows the preview column from xl, and the recap below it", () => {
    const { container } = render(
      <>
        <AddPuzzleLayout form={<p>form</p>} preview={<p>preview</p>} />
        <AddPuzzleSummary
          title="Harbour at dusk"
          brand=""
          pieceCount={undefined}
        />
      </>,
      { wrapper },
    );
    const grid = container.firstElementChild!;
    expect(classes(grid)).toContain("xl:grid-cols-[minmax(0,1fr)_332px]");
    expect(grid.getAttribute("class")).not.toMatch(/\blg:/);
    const aside = container.querySelector("aside")!;
    expect(classes(aside)).toEqual(
      expect.arrayContaining(["hidden", "xl:flex", "xl:sticky"]),
    );
    expect(aside.getAttribute("class")).not.toMatch(/\blg:/);
    expect(classes(screen.getByTestId("add-summary"))).toContain("xl:hidden");
    expect(classes(screen.getByTestId("add-summary"))).not.toContain(
      "lg:hidden",
    );
  });
});
