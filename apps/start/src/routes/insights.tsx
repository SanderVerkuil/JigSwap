import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { gateway } from "@jigswap/gateway";

// The proof of the seam: platform-wide counters read through the SHARED gateway
// (gateway.insights.globalStats), never the Convex generated API. Auth-light, so it
// renders end-to-end without a signed-in user.
const globalStatsQuery = convexQuery(gateway.insights.globalStats, {});

export const Route = createFileRoute("/insights")({
  // Prefetch on the server so the cards are present in the SSR HTML.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(globalStatsQuery);
  },
  component: Insights,
});

function Insights() {
  const { data } = useSuspenseQuery(globalStatsQuery);
  const cards: Array<{ label: string; value: number }> = [
    { label: "Members", value: data.totalUsers },
    { label: "Catalog puzzles", value: data.totalPuzzles },
    { label: "Owned copies", value: data.totalOwnedPuzzles },
  ];

  return (
    <main style={{ padding: "1rem" }}>
      <h1>Platform insights</h1>
      <p>
        Live from Convex via <code>gateway.insights.globalStats</code>.
      </p>
      <ul
        style={{
          display: "flex",
          gap: "1rem",
          listStyle: "none",
          padding: 0,
          flexWrap: "wrap",
        }}
      >
        {cards.map((card) => (
          <li
            key={card.label}
            style={{
              border: "1px solid #ccc",
              borderRadius: "8px",
              padding: "1rem 1.5rem",
              minWidth: "10rem",
            }}
          >
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>
              {card.value.toLocaleString()}
            </div>
            <div>{card.label}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
