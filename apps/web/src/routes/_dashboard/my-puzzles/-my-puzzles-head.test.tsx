// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  PageHeaderSlotProvider,
  usePageHeaderContent,
} from "@/components/dashboard-layout/page-header-slot";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// My Puzzles' page head keeps one primary action (Add Puzzle) beside a ⋯ menu; "My suggestions"
// lives in that menu (the guided tour points at the ⋯ button) instead of taking a header slot.

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));

function PublishedActions() {
  return <div data-testid="head">{usePageHeaderContent().actions}</div>;
}

const renderHead = () => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  // Every read stays pending: the page head is published regardless of the library loading.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PageHeaderSlotProvider>
          <Page />
          <PublishedActions />
        </PageHeaderSlotProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("My Puzzles page head", () => {
  it("shows Add Puzzle and a ⋯ menu, not a My suggestions button", () => {
    renderHead();
    expect(
      screen.getByRole("link", { name: "Add Puzzle" }).getAttribute("href"),
    ).toBe("/my-puzzles/add");
    expect(screen.queryByRole("link", { name: "My suggestions" })).toBeNull();
    const more = screen.getByRole("button", { name: "More actions" });
    expect(more.getAttribute("data-tour")).toBe("my-puzzles-suggestions");
  });

  it("opens My suggestions from the ⋯ menu", () => {
    renderHead();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "More actions" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );
    const item = screen.getByRole("menuitem", { name: "My suggestions" });
    expect(item.getAttribute("href")).toBe("/my-puzzles/suggestions");
  });
});
