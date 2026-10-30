// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const mocks = vi.hoisted(() => ({
  search: {} as { invite?: string; create?: true },
  navigate: vi.fn(),
}));

// The route module only needs its options back and the current search.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
}));

const circle = (
  aggregateId: string | undefined,
  name: string,
  fields: {
    isOwnedByViewer?: boolean;
    viewerPermission?: "ViewOnly" | "Exchange" | "Admin";
  } = {},
) => ({
  _id: `row_${name}`,
  aggregateId,
  name,
  memberCount: 3,
  isOwnedByViewer: false,
  viewerPermission: "ViewOnly" as const,
  createdAt: 0,
  ...fields,
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

beforeEach(() => {
  mocks.search = {};
  mocks.navigate.mockReset();
});

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

  it("shows the viewer's own permission on each row, not just 'Member'", () => {
    renderList([
      circle("c1", "Puzzle Club"),
      circle("c2", "Family", { viewerPermission: "Exchange" }),
      circle("c3", "Mine", {
        isOwnedByViewer: true,
        viewerPermission: "Admin",
      }),
    ]);
    const rowOf = (name: string) => screen.getByText(name).closest("a");
    expect(rowOf("Puzzle Club")?.textContent).toContain("View only");
    expect(rowOf("Family")?.textContent).toContain("Can exchange");
    expect(rowOf("Mine")?.textContent).toContain("Owner");
    expect(screen.queryByText("Member")).toBeNull();
    // Inside the row's link the badge is text, never a nested control.
    expect(rowOf("Family")?.querySelector("button")).toBeNull();
  });

  it("renders a legacy circle without an id as plain text", () => {
    renderList([circle(undefined, "Old Club")]);
    expect(screen.getByText("Old Club").closest("a")).toBeNull();
  });
});

// UX-58: the ⌘K "Create a Circle" quick action lands on /circles?create=1 with the dialog open.
describe("create dialog deep link", () => {
  it("opens the create dialog for ?create=1", () => {
    mocks.search = { create: true };
    renderList([]);
    expect(screen.getByRole("dialog", { name: "Create Circle" })).toBeTruthy();
  });

  it("stays closed without it", () => {
    renderList([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops create from the URL when the dialog closes, keeping the invite", () => {
    mocks.search = { create: true, invite: "inv_1" };
    renderList([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/circles",
      search: { invite: "inv_1" },
      replace: true,
    });
  });

  it("does not navigate when a dialog opened from the page closes", () => {
    renderList([]);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create Circle" })[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
