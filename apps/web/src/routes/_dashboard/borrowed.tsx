import { createFileRoute, redirect } from "@tanstack/react-router";

// The old Borrowed page. Every open loan, borrowed and lent out, now lives on Exchanges › Loans, so
// this path only forwards old links and bookmarks there (replacing the history entry, so Back
// doesn't bounce through the redirect again).
export const Route = createFileRoute("/_dashboard/borrowed")({
  beforeLoad: () => {
    throw redirect({ to: "/trades", search: { tab: "loans" }, replace: true });
  },
});
