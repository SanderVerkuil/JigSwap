// @vitest-environment happy-dom
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CopyInstanceScreen } from "./copy-instance-screen";

// A copy that can't be shown: the not-found names itself in the page head and leads back to the
// list the copy was opened under.

const mocks = vi.hoisted(() => ({
  // The copy read: `null` for a missing copy; `isError` for an unreadable id.
  copy: null as unknown,
  isError: false,
}));

vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  useLocation: (opts?: {
    select?: (location: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: "/copies/copy_1" };
    return opts?.select ? opts.select(location) : location;
  },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: FunctionReference<"query">, args: unknown) => ({
    name: getFunctionName(ref),
    args,
  }),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: mocks.isError ? undefined : mocks.copy,
    isPending: false,
    isError: mocks.isError,
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function PublishedHead() {
  const { title, crumbs } = usePageHeaderContent();
  return (
    <output data-testid="head">{JSON.stringify({ title, crumbs })}</output>
  );
}

const renderNotFound = ({
  owned,
  isError = false,
  locale = "en",
}: {
  owned: boolean;
  isError?: boolean;
  locale?: "en" | "nl";
}) => {
  mocks.copy = null;
  mocks.isError = isError;
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <PageHeaderSlotProvider>
        <CopyInstanceScreen copyId="copy_1" owned={owned} />
        <PublishedHead />
      </PageHeaderSlotProvider>
    </IntlProvider>,
  );
};

const head = () => JSON.parse(screen.getByTestId("head").textContent ?? "");

afterEach(cleanup);

describe("a copy that can't be shown", () => {
  it("leads the owner back to My Puzzles", async () => {
    renderNotFound({ owned: true });
    expect(
      screen
        .getByRole("link", { name: "Back to My Puzzles" })
        .getAttribute("href"),
    ).toBe("/my-puzzles");
    expect(screen.getByText(en.copyInstance.notFoundSub)).toBeTruthy();
    await waitFor(() =>
      expect(head()).toEqual({ title: "Copy not found", crumbs: [] }),
    );
  });

  it("leads anyone else back to Browse", () => {
    renderNotFound({ owned: false });
    expect(
      screen
        .getByRole("link", { name: "Back to Browse Puzzles" })
        .getAttribute("href"),
    ).toBe("/browse");
  });

  it("treats an unreadable id as not found, never as loading", () => {
    renderNotFound({ owned: false, isError: true });
    expect(screen.getByText(en.copyInstance.notFoundSub)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back to Browse Puzzles" }),
    ).toBeTruthy();
  });

  it("puts the title in the page head, not in a second h1", () => {
    renderNotFound({ owned: true });
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("speaks Dutch", () => {
    renderNotFound({ owned: true, locale: "nl" });
    expect(
      screen.getByRole("link", { name: "Terug naar Mijn puzzels" }),
    ).toBeTruthy();
  });
});
