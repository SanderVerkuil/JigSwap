// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PuzzleCard, PuzzleViewProvider } from "./puzzle-card";

// Router-free Link: the test asserts card layout, not routing.
vi.mock("@/compat/link", () => {
  const Link = ({ children }: { children?: ReactNode }) => (
    <a href="#">{children}</a>
  );
  return { Link, default: Link };
});
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));

const copy = {
  _id: "c1",
  puzzleId: "p1",
  condition: "good",
  visibility: "public",
  availability: { forLend: true, forTrade: true, forSale: true },
  puzzle: { title: "Lam Gelegd", pieceCount: 500 },
} as unknown as ComponentProps<typeof PuzzleCard>["puzzle"];

describe("owned-copy PuzzleCard", () => {
  it("wraps the offer badges, which do not fit one row of a compact phone card", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PuzzleViewProvider viewMode="grid">
          <PuzzleCard puzzle={copy} />
        </PuzzleViewProvider>
      </IntlProvider>,
    );
    const offer = [...host.querySelectorAll("[data-slot=badge]")].find(
      (el) => el.textContent === "For Trade",
    )!;
    expect(offer.parentElement!.classList).toContain("flex-wrap");
  });
});
