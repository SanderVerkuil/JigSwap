import { createFileRoute } from "@tanstack/react-router";

// Placeholder anchor child for the _dashboard pathless layout (URL: /dashboard).
// A childless pathless layout resolves to "/" and collides with the landing route,
// so the shell needs at least one child. Part 2 replaces this with the real
// dashboard landing (welcome / quick-actions / feature-sections / recent-activity),
// once those (dashboard) leaf components are ported.
export const Route = createFileRoute("/_dashboard/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return <div className="space-y-6" />;
}
