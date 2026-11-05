// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useState, type ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import type { ReportStatus } from "./moderation-search";
import { nextOpenReportId, ReportsQueue } from "./reports-queue";

// The drawer's getReport result: still loading unless a test sets an error.
type ReportQueryResult = {
  data: undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
};
const loadingReport = (): ReportQueryResult => ({
  data: undefined,
  isPending: true,
  isError: false,
  isFetching: true,
  error: null,
  refetch: vi.fn(),
});

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown) => unknown>(),
  reportQuery: vi.fn<() => unknown>(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown) =>
    mocks.paginated(ref, args),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => mocks.reportQuery(),
}));
// The drawer's member links; routing itself is not under test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

const NOW = new Date("2026-10-18T12:00:00Z");

afterEach(() => {
  cleanup();
  mocks.reportQuery.mockReset();
  changes.status = [];
  changes.open = [];
});

const OPEN_REPORT = {
  reportId: "r1",
  targetKind: "message",
  targetId: "m1",
  reason: "spam_scam",
  status: "open",
  createdAt: NOW.getTime() - 2 * 3_600_000,
  reporterLabel: "Rita",
  reportedUserId: "u2",
  reportedLabel: "Otto",
  targetSummary: "Cheap puzzles here",
  openReportsAgainstReported: 3,
};

// The route owns the status filter and the open report (both live in the URL); this harness
// stands in for it with local state and records what the queue asked for.
const changes = { status: [] as ReportStatus[], open: [] as (string | null)[] };
function Harness({
  initialStatus = "open",
  initialOpen = null,
}: {
  initialStatus?: ReportStatus;
  initialOpen?: string | null;
}) {
  const [status, setStatus] = useState<ReportStatus>(initialStatus);
  const [openId, setOpenId] = useState<string | null>(initialOpen);
  return (
    <ReportsQueue
      emptyTitle="All clear"
      status={status}
      openId={openId}
      onStatusChange={(next) => {
        changes.status.push(next);
        setStatus(next);
      }}
      onOpen={(id) => {
        changes.open.push(id);
        setOpenId(id);
      }}
    />
  );
}

const renderQueue = (props: Parameters<typeof Harness>[0] = {}) =>
  render(
    <IntlProvider
      locale="en"
      messages={en}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      <Harness {...props} />
    </IntlProvider>,
  );

// Opens the drawer for the single listed report.
const openDrawer = () => {
  mocks.paginated.mockReturnValue({
    results: [OPEN_REPORT],
    status: "Exhausted",
    loadMore: vi.fn(),
  });
  renderQueue();
  fireEvent.click(screen.getByText("Cheap puzzles here").closest("button")!);
  return screen.getByRole("dialog", { name: "Report" });
};

describe("ReportsQueue", () => {
  it("lists reason, summary, reporter → reported, open count and age; filters by status", () => {
    mocks.reportQuery.mockReturnValue(loadingReport());
    mocks.paginated.mockReturnValue({
      results: [OPEN_REPORT],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    renderQueue();
    expect(mocks.paginated).toHaveBeenLastCalledWith(expect.anything(), {
      status: "open",
    });
    const row = screen.getByText("Cheap puzzles here").closest("button")!;
    expect(row.textContent).toContain("Spam or scam");
    expect(row.textContent).toContain("Rita");
    expect(row.textContent).toContain("Otto");
    expect(row.textContent).toContain("3 open reports against this member");
    expect(row.textContent).toContain("2 hours ago");

    fireEvent.click(screen.getByRole("button", { name: "Dismissed" }));
    expect(changes.status).toEqual(["dismissed"]);
    expect(mocks.paginated).toHaveBeenLastCalledWith(expect.anything(), {
      status: "dismissed",
    });

    fireEvent.click(row);
    expect(changes.open).toEqual(["r1"]);
    expect(screen.getByRole("dialog", { name: "Report" })).toBeTruthy();
  });

  it("follows the status and open report it is given (a shared link), and reports a close", () => {
    mocks.reportQuery.mockReturnValue(loadingReport());
    mocks.paginated.mockReturnValue({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    renderQueue({ initialStatus: "actioned", initialOpen: "r9" });

    expect(mocks.paginated).toHaveBeenLastCalledWith(expect.anything(), {
      status: "actioned",
    });
    expect(
      screen
        // The open drawer hides the page behind it from the accessibility tree.
        .getByRole("button", { name: "Actioned", hidden: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // The drawer opens for the linked report even when it is not on the loaded page.
    const drawer = screen.getByRole("dialog", { name: "Report" });
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(changes.open).toEqual([null]);
  });

  it("says the report no longer exists when getReport throws NotFound", () => {
    mocks.reportQuery.mockReturnValue({
      ...loadingReport(),
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ConvexError({ code: "NotFound", message: "Not found" }),
    });
    const drawer = openDrawer();

    expect(drawer.textContent).toContain("This report no longer exists");
    expect(drawer.textContent).not.toContain("Loading reports");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows a retryable error instead of an endless spinner when getReport fails", () => {
    const refetch = vi.fn();
    mocks.reportQuery.mockReturnValue({
      ...loadingReport(),
      isPending: false,
      isError: true,
      isFetching: false,
      error: new ConvexError("Forbidden"),
      refetch,
    });
    const drawer = openDrawer();

    expect(drawer.querySelector('[role="alert"]')).not.toBeNull();
    expect(drawer.textContent).not.toContain("Loading reports");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("goes on to the next open report from a decided one", () => {
    // Deciding took r2 out of the open list; r3 (older) took its place.
    mocks.paginated.mockReturnValue({
      results: [
        { ...OPEN_REPORT, reportId: "r1", createdAt: 300 },
        { ...OPEN_REPORT, reportId: "r3", createdAt: 100 },
      ],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    mocks.reportQuery.mockReturnValue({
      ...loadingReport(),
      isPending: false,
      isFetching: false,
      data: {
        ...OPEN_REPORT,
        reportId: "r2",
        createdAt: 200,
        status: "actioned",
        decision: "warned",
        statementOfReasons: "Rude language.",
        decidedByLabel: "Ada",
        evidence: {},
        reporterId: "u1",
        photoUrl: null,
        otherReportCount: 0,
        otherReports: [],
      },
    });
    renderQueue({ initialOpen: "r2" });

    fireEvent.click(screen.getByRole("button", { name: "Next open report" }));
    expect(changes.open).toEqual(["r3"]);
  });
});

describe("nextOpenReportId", () => {
  const row = (reportId: string, createdAt: number, status = "open") => ({
    reportId,
    createdAt,
    status,
  });
  // Newest first, as admin.listReports returns them.
  const rows = [row("a", 500), row("b", 400), row("c", 300), row("d", 200)];

  it("is the next row down while the current report is still listed", () => {
    expect(nextOpenReportId(rows, { reportId: "b", createdAt: 400 })).toBe("c");
  });

  it("is the row that took the decided report's place once it left the list", () => {
    const left = rows.filter((r) => r.reportId !== "b");
    expect(nextOpenReportId(left, { reportId: "b", createdAt: 400 })).toBe("c");
  });

  it("wraps to the top after the last one", () => {
    expect(nextOpenReportId(rows, { reportId: "d", createdAt: 200 })).toBe("a");
    expect(
      nextOpenReportId(rows.slice(0, 3), { reportId: "d", createdAt: 200 }),
    ).toBe("a");
  });

  it("skips reports that are no longer open", () => {
    const mixed = [row("a", 500), row("b", 400, "actioned"), row("c", 300)];
    expect(nextOpenReportId(mixed, { reportId: "a", createdAt: 500 })).toBe(
      "c",
    );
  });

  it("is null when no other open report is listed", () => {
    expect(
      nextOpenReportId([row("a", 500)], { reportId: "a", createdAt: 500 }),
    ).toBeNull();
    expect(
      nextOpenReportId([row("x", 500, "dismissed")], {
        reportId: "a",
        createdAt: 100,
      }),
    ).toBeNull();
    expect(nextOpenReportId([], { reportId: "a", createdAt: 100 })).toBeNull();
  });
});
