import { globalStatsQuery } from "@/lib/marketing-queries";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../locales/en.json";
import { Stats } from "./stats";

function render(totalUsers: number) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(globalStatsQuery.queryKey, {
    totalUsers,
    totalPuzzles: 120,
    totalOwnedPuzzles: 340,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Stats />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

describe("Stats", () => {
  it("is hidden while the community is too small to read as social proof", () => {
    expect(render(13)).toBe("");
  });

  it("shows the platform numbers once the community is big enough", () => {
    const html = render(50);
    expect(html).toContain("50 puzzlers");
    expect(html).toContain("340");
  });
});
