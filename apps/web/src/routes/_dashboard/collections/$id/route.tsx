import { createFileRoute, Outlet } from "@tanstack/react-router";

// Param layout for a single collection. Its only job is to establish
// `/collections/$id` as a real matchable route in the _dashboard chain so that
// unmatched deeper paths (e.g. /collections/<id>/edit) fuzzy-match this segment
// and render the app 404 inside the dashboard shell, instead of falling through
// to the root route's marketing 404. The children (index, add-puzzles) render
// through this Outlet unchanged.
export const Route = createFileRoute("/_dashboard/collections/$id")({
  component: () => <Outlet />,
});
