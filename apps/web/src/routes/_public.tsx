import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingNotFound } from "@/components/NotFound";
import { PageLoading } from "@/components/ui/loading";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// Pathless layout for the (public) marketing pages (about/contact/privacy/terms/
// how-it-works/features). Marketing chrome (sticky header + footer) on the
// brand-tinted ground; children keep their top-level URLs (/about, /contact, ...)
// and lay out their own full-width sections.
export const Route = createFileRoute("/_public")({
  pendingComponent: PublicPending,
  // 404 under a marketing route renders within this marketing shell (its Outlet).
  notFoundComponent: MarketingNotFound,
  component: PublicLayout,
});

function PublicPending() {
  const t = useTranslations("common");
  return <PageLoading message={t("loading")} />;
}

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
