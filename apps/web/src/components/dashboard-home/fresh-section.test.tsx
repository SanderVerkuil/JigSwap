// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { FreshSection } from "./fresh-section";

vi.mock("@/compat/link", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("./use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "m1" }, isMemberLoading: false }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [{ _id: "c1" }, { _id: "c2" }] }),
}));
// Stub the card (its own layout is covered elsewhere); keep the real grid provider.
vi.mock("@/components/ui/puzzle-card", async () => ({
  PuzzleViewProvider: (
    await import("@/components/puzzles/puzzle-view-provider")
  ).PuzzleViewProvider,
  PuzzleCard: () => <article />,
}));

describe("FreshSection", () => {
  it("gives every scroller cell one full-width card, not the two-column phone grid", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <FreshSection />
      </IntlProvider>,
    );
    const cells = [...host.querySelectorAll("article")].map(
      (card) => card.parentElement!,
    );
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(cell.className).not.toMatch(/grid-cols/);
    }
  });
});
