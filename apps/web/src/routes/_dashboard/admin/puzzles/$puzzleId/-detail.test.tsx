// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../../locales/en.json";
import { Route } from "./index";

// What this page says when a read stops short: its two reads are bounded on the server (a member can
// grow them past what one function may read), and a number that stopped counting must read as one.
const data = vi.hoisted(() => ({
  detail: null as unknown,
  proposals: null as unknown,
}));

vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: string) => ({ ref }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ ref }: { ref: string }) => ({
    data: ref === "proposals" ? data.proposals : data.detail,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/gateway", () => ({
  gateway: {
    admin: {
      getPuzzleDefinitionDetail: "detail",
      listProposalsForDefinition: "proposals",
    },
  },
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
}));
vi.mock("@/components/admin/puzzles/puzzle-lifecycle-action", () => ({
  PuzzleLifecycleAction: () => null,
}));
vi.mock("@/lib/member-display-name", () => ({
  useMemberDisplayName: () => (name: string) => name,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ puzzleId: "puzzle_1" }),
  }),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

const detail = (capped: boolean) => ({
  definition: {
    _id: "puzzle_1",
    aggregateId: "definition_1",
    title: "Starry Night",
    pieceCount: 1000,
    status: "approved",
    createdAt: Date.UTC(2026, 9, 1),
    updatedAt: Date.UTC(2026, 9, 1),
    image: null,
    submitter: null,
  },
  stats: {
    capped,
    ownerCount: 3,
    copies: { total: 2000, forTrade: 4, forSale: 0, forLend: 1 },
  },
  owners: [],
  audit: [],
});

const renderPage = () => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <Page />
    </IntlProvider>,
  );
};

afterEach(cleanup);

describe("the admin definition page", () => {
  it("shows its counts as they are when it read every copy", () => {
    data.detail = detail(false);
    data.proposals = { proposals: [], capped: false };
    renderPage();
    expect(screen.getByText("2,000")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText(/\+$/)).toBeNull();
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it("shows them as lower bounds when the read stopped", () => {
    data.detail = detail(true);
    data.proposals = { proposals: [], capped: false };
    renderPage();
    expect(screen.getByText("2,000+")).toBeTruthy();
    expect(screen.getByText("3+")).toBeTruthy();
  });

  it("says it shows the newest suggested edits when there are older ones", () => {
    data.detail = detail(false);
    data.proposals = {
      proposals: [
        {
          _id: "proposal_1",
          aggregateId: "proposal_1",
          status: "withdrawn",
          changes: { title: "A" },
          createdAt: Date.UTC(2026, 9, 1),
        },
      ],
      capped: true,
    };
    renderPage();
    expect(
      screen.getByText("Showing the newest 1 suggested edits."),
    ).toBeTruthy();
  });
});
