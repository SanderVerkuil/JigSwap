// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { ActivityLog } from "./activity-log";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: mocks.rows, isPending: false }),
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
  it("names a member whose account is gone with the localized 'Deleted member' (SEC-57)", () => {
    mocks.rows = [
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
    ];
    renderIn("nl");
    expect(screen.getByText(/na een melding/).closest("p")?.textContent).toBe(
      "Ada waarschuwde Verwijderd lid na een melding",
    );
    expect(screen.getByText(/beheerder/).closest("p")?.textContent).toBe(
      "Ada maakte Otto beheerder",
    );
    cleanup();

    renderIn("en");
    expect(screen.getByText(/after a report/).closest("p")?.textContent).toBe(
      "Ada warned Deleted member after a report",
    );
  });
});
