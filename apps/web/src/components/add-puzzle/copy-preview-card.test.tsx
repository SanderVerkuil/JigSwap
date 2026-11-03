// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CopyPreviewCard } from "./live-preview-card";

vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}));

afterEach(cleanup);

describe("CopyPreviewCard", () => {
  // It renders the real puzzle card under the page's h1, and a card's h3 would skip a level.
  it("titles the preview one level under the page's h1", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <CopyPreviewCard
            title="Café"
            brand=""
            pieceCount={1000}
            condition="good"
            availability={{ forTrade: false, forLend: false, forSale: false }}
          />
        </IntlProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Café" }).tagName).toBe("H2");
  });
});
