// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import type { DocFeedbackEntry } from "./doc-feedback-summary";
import { DocFeedbackSummaryList } from "./doc-feedback-summary-list";

// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: { _splat?: string };
    children?: ReactNode;
  }) => (
    <a href={to.replace("$", params?._splat ?? "")} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

let seq = 0;
const vote = (
  slug: string,
  helpful: boolean,
  comment?: string,
): DocFeedbackEntry => ({
  _id: `v${++seq}`,
  slug,
  helpful,
  createdAt: Date.UTC(2026, 9, 1, 12, seq),
  ...(comment ? { comment } : {}),
});

const entries = [
  vote("library/lending", true),
  vote("swapping/how-a-swap-works", false, "Too long, I gave up halfway."),
  vote("swapping/how-a-swap-works", false),
  vote("swapping/how-a-swap-works", true),
];

const renderList = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <DocFeedbackSummaryList entries={entries} />
    </IntlProvider>,
  );

describe("DocFeedbackSummaryList", () => {
  it("shows one row per docs page, least helpful first, linking to the page", () => {
    renderList();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "swapping/how-a-swap-works",
      "library/lending",
    ]);
    expect(links[0]?.getAttribute("href")).toBe(
      "/docs/swapping/how-a-swap-works",
    );
  });

  it("counts both votes and emphasises the not-helpful count with its share", () => {
    renderList();
    // Both pages have one helpful vote.
    expect(screen.getAllByText("1 helpful")).toHaveLength(2);
    const notHelpful = screen.getByText("2 not helpful (67%)");
    expect(notHelpful.className).toContain("bg-red-700");
    // A page without not-helpful votes keeps the quiet tone.
    expect(screen.getByText("0 not helpful (0%)").className).not.toContain(
      "bg-red-700",
    );
  });

  it("keeps comments behind a disclosure until it is opened", () => {
    renderList();
    const toggle = screen.getByRole("button", { name: "1 comment" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Too long, I gave up halfway.")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const comment = screen.getByText("Too long, I gave up halfway.");
    expect(
      within(comment.closest("li")!).getByText(/Not helpful/),
    ).toBeTruthy();
  });

  it("speaks Dutch in Dutch", () => {
    renderList("nl");
    expect(screen.getByText("2 niet nuttig (67%)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 opmerking" })).toBeTruthy();
  });
});
