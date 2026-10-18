// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { NewCopyConversation } from "./new-copy-conversation";

const mocks = vi.hoisted(() => ({
  view: undefined as unknown,
  navigate: vi.fn(),
}));

// The pane's data comes from getCopyConversation; the test feeds the view directly.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.view, isError: false }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" } }),
}));
// Router-free links: the test asserts the rendered DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const renderPane = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <NewCopyConversation copyId="copy1" />
    </IntlProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.view = undefined;
});

describe("NewCopyConversation — ownerHidden", () => {
  it("explains the owner is private and offers no composer", () => {
    mocks.view = { status: "ownerHidden" };
    renderPane();

    expect(
      screen.getByText(
        "This owner keeps their profile private, so you can't message them from here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Back to the puzzle" })
        .getAttribute("href"),
    ).toBe("/copies/copy1");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("explains it in Dutch", () => {
    mocks.view = { status: "ownerHidden" };
    renderPane("nl");

    expect(
      screen.getByText(
        "Deze eigenaar heeft een privéprofiel, dus vanaf hier kun je geen bericht sturen.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
