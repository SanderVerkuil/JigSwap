// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { MyReports } from "./my-reports";

const renderList = (reports: unknown[]) => {
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
    convexQuery(gateway.reports.listMyReports, {}).queryKey,
    reports,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <MyReports />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("MyReports", () => {
  it("shows the empty state", () => {
    renderList([]);
    expect(screen.getByText("You haven't reported anything.")).toBeTruthy();
  });

  it("lists target · reason · status · date", () => {
    renderList([
      {
        reportId: "r1",
        targetKind: "message",
        targetId: "m1",
        reason: "harassment_hate",
        status: "open",
        createdAt: Date.UTC(2026, 9, 17),
      },
      {
        reportId: "r2",
        targetKind: "photo",
        targetId: "p1",
        reason: "sexual",
        status: "dismissed",
        decision: "dismissed",
        createdAt: Date.UTC(2026, 9, 1),
      },
    ]);
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows).toEqual([
      "A message·Harassment or hate·Under review·Oct 17, 2026",
      "A photo·Sexual or inappropriate content·Handled·Oct 1, 2026",
    ]);
  });
});
