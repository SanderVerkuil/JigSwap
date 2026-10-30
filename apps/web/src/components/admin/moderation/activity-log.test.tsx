// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { ActivityLog } from "./activity-log";

const mocks = vi.hoisted(() => ({ query: vi.fn<() => unknown>() }));

vi.mock("@/gateway", () => ({ gateway: { admin: {} } }));
vi.mock("@convex-dev/react-query", () => ({ convexQuery: () => ({}) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => mocks.query(),
}));

const NOW = new Date("2026-10-30T12:00:00Z");

afterEach(cleanup);

const renderIn = (locale: "en" | "nl") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
      now={NOW}
    >
      <ActivityLog emptyTitle="All clear" />
    </IntlProvider>,
  );

describe("ActivityLog", () => {
  it("names a member whose account is gone with a localized in-sentence 'a deleted member' (SEC-57)", () => {
    mocks.query.mockReturnValue({
      data: [
        {
          kind: "report_warned",
          actorName: "Ada",
          targetLabel: "Deleted member",
          targetMemberDeleted: true,
          targetId: "r1",
          at: NOW.getTime() - 60_000,
        },
        {
          kind: "role_granted",
          actorName: "Ada",
          targetLabel: "Otto",
          targetId: "u2",
          at: NOW.getTime() - 120_000,
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderIn("nl");
    expect(screen.getByText(/na een melding/).closest("p")?.textContent).toBe(
      "Ada waarschuwde een verwijderd lid na een melding",
    );
    expect(screen.getByText(/beheerder/).closest("p")?.textContent).toBe(
      "Ada maakte Otto beheerder",
    );
    cleanup();

    renderIn("en");
    expect(screen.getByText(/after a report/).closest("p")?.textContent).toBe(
      "Ada warned a deleted member after a report",
    );
  });

  it("shows a retryable error, not the loading state, when the query fails", () => {
    const refetch = vi.fn();
    mocks.query.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    renderIn("en");

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(en.admin.moderation.activity.loading)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while the query is pending", () => {
    mocks.query.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    });
    renderIn("en");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(en.admin.moderation.activity.loading)).toBeTruthy();
  });
});
