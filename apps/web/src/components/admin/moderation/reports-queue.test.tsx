// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { ReportsQueue } from "./reports-queue";

const mocks = vi.hoisted(() => ({
  paginated: vi.fn<(ref: unknown, args: unknown) => unknown>(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (ref: unknown, args: unknown) =>
    mocks.paginated(ref, args),
}));
// The drawer's getReport never resolves here: only the list is under test.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
}));

const NOW = new Date("2026-10-18T12:00:00Z");

afterEach(cleanup);

describe("ReportsQueue", () => {
  it("lists reason, summary, reporter → reported, open count and age; filters by status", () => {
    mocks.paginated.mockReturnValue({
      results: [
        {
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
        },
      ],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    render(
      <IntlProvider
        locale="en"
        messages={en}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <ReportsQueue emptyTitle="All clear" />
      </IntlProvider>,
    );
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
    expect(mocks.paginated).toHaveBeenLastCalledWith(expect.anything(), {
      status: "dismissed",
    });

    fireEvent.click(row);
    expect(screen.getByRole("dialog", { name: "Report" })).toBeTruthy();
  });
});
