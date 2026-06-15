import { Outlet, createFileRoute } from "@tanstack/react-router";

import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { PageLoading } from "@/components/ui/loading";

// Pathless layout for the (public) marketing pages (about/contact/privacy/terms/
// how-it-works/features). Marketing chrome (sticky header + footer) on the
// brand-tinted ground; children keep their top-level URLs (/about, /contact, ...)
// and lay out their own full-width sections.
export const Route = createFileRoute("/_public")({
  pendingComponent: () => <PageLoading message="Loading..." />,
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="mk-root font-mk-sans min-h-screen flex flex-col overflow-x-clip">
      <MarketingHeader />
      <div className="flex-1">
        <Outlet />
      </div>
      <MarketingFooter />
    </div>
  );
}
