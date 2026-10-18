// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

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

// The route module only needs its options back and an empty search.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
}));

const circle = (aggregateId: string | undefined, name: string) => ({
  _id: `row_${name}`,
  aggregateId,
  ownerId: "u_anna",
  name,
  memberCount: 3,
  isOwnedByViewer: false,
  viewerPermission: "ViewOnly" as const,
  createdAt: 0,
});

const renderList = (circles: ReturnType<typeof circle>[]) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
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
  queryClient.setQueryData(
    convexQuery(gateway.sharing.myCircles, {}).queryKey,
    circles,
  );
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("circles list rows", () => {
  it("links each circle's name to its own page", () => {
    renderList([circle("circle 1", "Puzzle Club")]);
    const link = screen.getByText("Puzzle Club").closest("a");
    expect(link?.getAttribute("href")).toBe("/circles/circle%201");
    // The actions sit outside the link (no nested interactive content).
    const chat = screen.getByRole("button", {
      name: "Open group chat: Puzzle Club",
    });
    expect(link?.contains(chat)).toBe(false);
  });

  it("renders a legacy circle without an id as plain text", () => {
    renderList([circle(undefined, "Old Club")]);
    expect(screen.getByText("Old Club").closest("a")).toBeNull();
  });
});
