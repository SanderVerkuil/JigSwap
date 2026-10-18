// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfilePuzzlesSection } from "./profile-listings";

// The profile's puzzle list: the all/available filter is offered only when the server says the
// viewer sees the whole library (scope "all"); otherwise a note explains the listings-only view.

const paginated = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  results: [{ _id: "c1" }, { _id: "c2" }] as Array<{ _id: string }>,
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (_query: unknown, args: Record<string, unknown>) => {
    paginated.calls.push(args);
    return {
      results: paginated.results,
      status: "Exhausted",
      loadMore: () => {},
    };
  },
}));

vi.mock("@/components/ui/puzzle-card", () => ({
  PuzzleViewProvider: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  PuzzleCard: ({ puzzle }: { puzzle: { _id: string } }) => (
    <article data-testid="card">{puzzle._id}</article>
  ),
}));

const renderSection = (scope: "all" | "available") =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <ProfilePuzzlesSection
        memberId={"member1" as never}
        firstName="Hans"
        scope={scope}
      />
    </IntlProvider>,
  );

const lastArgs = () => paginated.calls[paginated.calls.length - 1];

beforeEach(() => {
  paginated.calls = [];
  paginated.results = [{ _id: "c1" }, { _id: "c2" }];
});
afterEach(() => cleanup());

describe("ProfilePuzzlesSection filter", () => {
  it("scope 'all': offers All/Available, defaulting to All", () => {
    renderSection("all");
    const group = screen.getByRole("radiogroup", {
      name: "Which of Hans's puzzles to show",
    });
    expect(group).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "All puzzles" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(lastArgs()).toMatchObject({ memberId: "member1", filter: "all" });
    expect(
      screen.queryByText("Puzzles Hans offers to swap, lend or sell."),
    ).toBeNull();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("scope 'all': choosing Available re-queries with filter 'available'", () => {
    renderSection("all");
    fireEvent.click(screen.getByRole("radio", { name: "Available" }));
    expect(lastArgs()).toMatchObject({ filter: "available" });
    expect(
      screen
        .getByRole("radio", { name: "Available" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Puzzles Hans offers to swap, lend or sell."),
    ).toBeTruthy();
  });

  it("scope 'all' + Available with nothing open: keeps the filter and says so", () => {
    renderSection("all");
    paginated.results = [];
    fireEvent.click(screen.getByRole("radio", { name: "Available" }));
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(
      screen.getByText(
        "Hans has no puzzles available to swap, lend or sell right now.",
      ),
    ).toBeTruthy();
  });

  it("scope 'available': no filter, a listings-only note, queries 'available'", () => {
    renderSection("available");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(
      screen.getByText("Puzzles Hans offers to swap, lend or sell."),
    ).toBeTruthy();
    expect(lastArgs()).toMatchObject({ filter: "available" });
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("renders nothing when the default list is empty", () => {
    paginated.results = [];
    const { container } = renderSection("all");
    expect(container.innerHTML).toBe("");
  });
});
