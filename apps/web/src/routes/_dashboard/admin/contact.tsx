import { ContactInbox } from "@/components/admin/contact/contact-inbox";
import { validateContactSearch } from "@/components/admin/contact/contact-search";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/admin/contact")({
  // `?status=` is the inbox filter (absent = New), so a reload or Back keeps it.
  validateSearch: validateContactSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "adminContact") }],
  }),
  component: ContactTriagePage,
});

// Admin triage inbox for the public contact form (ContactInbox): New / Handled / All, paginated,
// with a single "mark as handled" transition (new -> handled). The listing and the transition are
// admin-gated server-side in the Convex functions.
function ContactTriagePage() {
  const { status } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // The same bounded count the sidebar badge shows (TanStack Query shares the subscription).
  const { data: pendingCounts } = useQuery(
    convexQuery(gateway.admin.pendingCounts, {}),
  );

  return (
    <ContactInbox
      status={status ?? "new"}
      onStatusChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            status: next === "new" ? undefined : next,
          }),
          replace: true,
          resetScroll: false,
        })
      }
      newCount={pendingCounts?.contact}
    />
  );
}
